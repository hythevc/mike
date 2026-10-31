// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider" with {
    "resolution-mode": "import",
};

const { inserts, control, tokensOf } = vi.hoisted(() => ({
    inserts: [] as Array<Record<string, unknown>>,
    control: { insertError: null as { message: string } | null },
    tokensOf: (rows: Array<Record<string, unknown>>) =>
        rows.reduce(
            (sum, row) => sum + Number(row.input_tokens) + Number(row.output_tokens),
            0,
        ),
}));

// The ledger: the rows written, and this month's deployment-key totals read
// back from them, as usage_deployment_key_tokens computes them.
vi.mock("../../supabase", () => ({
    createServerSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                if (table === "usage_events") inserts.push(row);
                return { error: control.insertError };
            },
        }),
        rpc: async (name: string, args: Record<string, unknown>) => {
            const env = inserts.filter((row) => row.key_source === "env");
            return name === "usage_deployment_key_tokens"
                ? {
                      data: [
                          {
                              workspace_tokens: tokensOf(
                                  env.filter((row) => row.org_id === args.p_org_id),
                              ),
                              person_tokens: tokensOf(
                                  env.filter((row) => row.user_id === args.p_user_id),
                              ),
                              workspace_personal: args.p_org_id === null,
                          },
                      ],
                      error: null,
                  }
                : { data: null, error: { message: `unexpected rpc ${name}` } };
        },
    }),
}));

import { completeAiSdkText, streamAiSdk } from "../aiSdk";
import {
    currentUsageContext,
    runWithUsageContext,
    withUsageSurface,
    type UsageContext,
} from "../usageContext";
import {
    assertDeploymentKeyAllowance,
    DEPLOYMENT_QUOTA_EXCEEDED_CODE,
    resetDeploymentTotalsForTests,
    settleUsageWrites,
} from "../../usage";
import { promptCharacters, reportedUsage } from "../usageMeter";
import {
    AssistantStreamAskInputsPause,
    callStep,
    config,
    makeModel,
    okRunTools,
    step,
    text,
    toolCall,
    TOOLS,
    type Part,
} from "./mockLanguageModel";

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const CHAT = "00000000-0000-4000-8000-000000000030";

const turn: UsageContext = {
    userId: USER,
    orgId: null,
    projectId: PROJECT,
    surface: "chat",
    chatId: CHAT,
};

/** A final step whose input was mostly served from the prompt cache. */
const cachedFinish: LanguageModelV3StreamPart = {
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
        inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: 0 },
    },
};

/** A step whose usage the provider reports in its finish part. */
const usageFinish = (
    reason: "stop" | "tool-calls",
    input: number | undefined,
    output: number | undefined,
): Part => ({
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
        inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: output, text: output, reasoning: undefined },
    },
});

/**
 * A model call that starts answering and never finishes on its own: the
 * stream stays open until the call is stopped.
 */
const unfinishedStep = (...parts: Part[]) => ({
    stream: new ReadableStream<Part>({
        start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "response-metadata", id: "resp", modelId: "mock" });
            for (const part of parts) controller.enqueue(part);
        },
    }),
});

const params = {
    model: "mock-model",
    systemPrompt: "s",
    messages: [{ role: "user" as const, content: "q" }],
};

beforeEach(() => {
    inserts.length = 0;
    control.insertError = null;
    resetDeploymentTotalsForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("usage context", () => {
    it("follows the work through awaits and timers, and nests", async () => {
        const seen: Array<string | undefined> = [];
        await runWithUsageContext(turn, async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            seen.push(currentUsageContext()?.surface);
            await withUsageSurface("subagent", { runId: "r" }, async () => {
                seen.push(currentUsageContext()?.surface);
                expect(currentUsageContext()).toMatchObject({
                    chatId: CHAT,
                    projectId: PROJECT,
                    runId: "r",
                });
            });
            seen.push(currentUsageContext()?.surface);
        });
        seen.push(currentUsageContext()?.surface);
        expect(seen).toEqual(["chat", "subagent", "chat", undefined]);
    });

    it("runs work outside any context as it is", () => {
        expect(withUsageSurface("title", {}, () => currentUsageContext())).toBeUndefined();
    });
});

describe("streamAiSdk usage recording", () => {
    it("records one row per call, with the tokens of every step", async () => {
        const model = await makeModel([
            callStep("c1", "read_document", { doc_id: "d" }),
            step(...text("Answer."), cachedFinish),
        ]);
        const result = await runWithUsageContext(turn, () =>
            streamAiSdk(
                { ...params, tools: TOOLS, runTools: okRunTools },
                { ...config(model), keySource: "org" },
            ),
        );
        await settleUsageWrites();
        expect(result.fullText).toBe("Answer.");
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
            surface: "chat",
            project_id: PROJECT,
            chat_id: CHAT,
            model: "mock-model",
            provider: "ollama",
            key_source: "org",
            input_tokens: 130,
            output_tokens: 35,
            cached_tokens: 100,
            tokens_estimated: false,
        });
    });

    it("does not fail the call when the ledger write fails", async () => {
        control.insertError = { message: "ledger unavailable" };
        const model = await makeModel([step(...text("Still answered."), cachedFinish)]);
        const result = await runWithUsageContext(turn, () =>
            streamAiSdk(params, config(model)),
        );
        await settleUsageWrites();
        expect(result.fullText).toBe("Still answered.");
        expect(inserts).toHaveLength(1);
    });

    it("records the steps a failed call had finished", async () => {
        const model = await makeModel([
            callStep("c1", "read_document", { doc_id: "d" }),
            new Error("provider went away"),
        ]);
        await expect(
            runWithUsageContext(turn, () =>
                streamAiSdk(
                    { ...params, tools: TOOLS, runTools: okRunTools },
                    config(model),
                ),
            ),
        ).rejects.toThrow();
        await settleUsageWrites();
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
            input_tokens: 10,
            output_tokens: 5,
            tokens_estimated: false,
        });
    });

    it("records a call that pauses in its first step, and counts it against the cap", async () => {
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "907");
        const model = await makeModel([
            step(
                toolCall("c1", "read_document", { doc_id: "d" }),
                usageFinish("tool-calls", 900, 7),
            ),
            step(...text("must not run after the pause"), usageFinish("stop", 1, 1)),
        ]);
        const pause = new AssistantStreamAskInputsPause();
        await expect(
            runWithUsageContext(turn, async () => {
                // Under the cap before the call.
                await assertDeploymentKeyAllowance("env");
                return streamAiSdk(
                    {
                        ...params,
                        tools: TOOLS,
                        runTools: async () => {
                            throw pause;
                        },
                    },
                    config(model),
                );
            }),
        ).rejects.toBe(pause);
        await settleUsageWrites();
        // The pausing step never reached finish-step, and is recorded anyway.
        expect(inserts).toEqual([
            expect.objectContaining({
                surface: "chat",
                key_source: "env",
                input_tokens: 900,
                output_tokens: 7,
                tokens_estimated: false,
            }),
        ]);
        // Its tokens count: the next deployment-key call is refused.
        await expect(assertDeploymentKeyAllowance("env", turn)).rejects.toMatchObject({
            code: DEPLOYMENT_QUOTA_EXCEEDED_CODE,
        });
    });

    it("estimates a model call stopped before its provider reported usage", async () => {
        const stop = new AbortController();
        const answered = "The partial answer so far";
        const model = await makeModel([
            unfinishedStep(
                { type: "text-start", id: "t0" },
                { type: "text-delta", id: "t0", delta: answered },
            ),
        ]);
        await expect(
            runWithUsageContext(turn, () =>
                streamAiSdk(
                    {
                        ...params,
                        abortSignal: stop.signal,
                        callbacks: { onContentDelta: () => stop.abort() },
                    },
                    config(model),
                ),
            ),
        ).rejects.toThrow();
        await settleUsageWrites();
        expect(inserts).toEqual([
            expect.objectContaining({
                surface: "chat",
                tokens_estimated: true,
                cached_tokens: 0,
                // About four characters a token of what had streamed back.
                output_tokens: Math.ceil(answered.length / 4),
            }),
        ]);
        // And of what it was sent: the system prompt and the question.
        expect(inserts[0].input_tokens).toBeGreaterThan(0);
    });

    it("counts nothing for a call stopped before any of its answer arrived", async () => {
        const stop = new AbortController();
        const model = await makeModel([unfinishedStep()]);
        const run = runWithUsageContext(turn, () =>
            streamAiSdk({ ...params, abortSignal: stop.signal }, config(model)),
        );
        setTimeout(() => stop.abort(), 20);
        await expect(run).rejects.toThrow();
        await settleUsageWrites();
        expect(inserts).toEqual([]);
    });

    it("estimates a model call whose provider reports no token counts", async () => {
        const model = await makeModel([
            step(...text("Unmetered answer."), usageFinish("stop", undefined, undefined)),
        ]);
        await runWithUsageContext(turn, () => streamAiSdk(params, config(model)));
        await settleUsageWrites();
        expect(inserts).toEqual([
            expect.objectContaining({
                tokens_estimated: true,
                output_tokens: Math.ceil("Unmetered answer.".length / 4),
            }),
        ]);
    });

    it("records nothing for a call that failed before any step finished", async () => {
        const model = await makeModel([new Error("refused")]);
        await expect(
            runWithUsageContext(turn, () => streamAiSdk(params, config(model))),
        ).rejects.toThrow();
        await settleUsageWrites();
        expect(inserts).toEqual([]);
    });

    it("records nothing outside a usage context", async () => {
        const model = await makeModel([step(...text("Hi."), cachedFinish)]);
        await streamAiSdk(params, config(model));
        await settleUsageWrites();
        expect(inserts).toEqual([]);
    });

    it("counts an adapter without a key source as the deployment's", async () => {
        const model = await makeModel([step(...text("Hi."), cachedFinish)]);
        await runWithUsageContext(turn, () => streamAiSdk(params, config(model)));
        await settleUsageWrites();
        expect(inserts[0]).toMatchObject({ key_source: "env" });
    });
});

describe("the usage meter", () => {
    it("counts a prompt's text, not its labels or attached files", () => {
        expect(
            promptCharacters([
                { role: "system", content: "Be brief." },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Summarise" },
                        { type: "file", data: "QUJDREVGR0g=", mediaType: "application/pdf" },
                        { type: "file", data: new Uint8Array(4096), mediaType: "image/png" },
                    ],
                    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
                },
            ]),
        ).toBe("Be brief.".length + "Summarise".length);
    });

    it("reads a provider's reported usage, and none when it reports no counts", () => {
        expect(
            reportedUsage({
                inputTokens: { total: 50, cacheRead: 40 },
                outputTokens: { total: 9 },
            }),
        ).toEqual({ inputTokens: 50, outputTokens: 9, cachedTokens: 40 });
        expect(reportedUsage({ inputTokens: {}, outputTokens: {} })).toBeNull();
        expect(reportedUsage(undefined)).toBeNull();
    });
});

describe("completeAiSdkText usage recording", () => {
    it("records the call's total usage as one row", async () => {
        const { MockLanguageModelV3 } = await import("ai/test");
        const model = new MockLanguageModelV3({
            doGenerate: async () => ({
                content: [{ type: "text", text: "A title" }],
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                    inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
                    outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
                warnings: [],
            }),
        });
        const title = await runWithUsageContext({ ...turn, surface: "title" }, () =>
            completeAiSdkText({ user: "Name this" }, { ...config(model), keySource: "user" }),
        );
        await settleUsageWrites();
        expect(title).toBe("A title");
        expect(inserts).toEqual([
            expect.objectContaining({
                surface: "title",
                key_source: "user",
                input_tokens: 40,
                output_tokens: 4,
                cached_tokens: 0,
            }),
        ]);
    });
});
