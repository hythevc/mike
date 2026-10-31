// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider" with {
    "resolution-mode": "import",
};

const { inserts, control } = vi.hoisted(() => ({
    inserts: [] as Array<Record<string, unknown>>,
    control: { insertError: null as { message: string } | null },
}));

vi.mock("../../supabase", () => ({
    createServerSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                if (table === "usage_events") inserts.push(row);
                return { error: control.insertError };
            },
        }),
    }),
}));

import { completeAiSdkText, streamAiSdk } from "../aiSdk";
import {
    currentUsageContext,
    runWithUsageContext,
    withUsageSurface,
    type UsageContext,
} from "../usageContext";
import { settleUsageWrites } from "../../usage";
import {
    callStep,
    config,
    makeModel,
    okRunTools,
    step,
    text,
    TOOLS,
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

const params = {
    model: "mock-model",
    systemPrompt: "s",
    messages: [{ role: "user" as const, content: "q" }],
};

beforeEach(() => {
    inserts.length = 0;
    control.insertError = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
        expect(inserts[0]).toMatchObject({ input_tokens: 10, output_tokens: 5 });
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
