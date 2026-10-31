// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

// A title goes through the real completion path down to the AI SDK adapter;
// only the provider is a scripted model and the ledger an in-memory list.
const { completeWithProvider, inserts } = vi.hoisted(() => ({
    completeWithProvider: vi.fn(),
    inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/llm/providers", () => ({
    completeWithProvider: (params: unknown) => completeWithProvider(params),
    streamWithProvider: vi.fn(),
}));
vi.mock("../../../lib/supabase", () => ({
    createServerSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                if (table === "usage_events") inserts.push(row);
                return { error: null };
            },
        }),
    }),
}));

import { completeAiSdkText } from "../../../lib/llm/aiSdk";
import { config } from "../../../lib/llm/__tests__/mockLanguageModel";
import {
    runWithUsageContext,
    type UsageContext,
} from "../../../lib/llm/usageContext";
import { settleUsageWrites } from "../../../lib/usage";
import { generateAssistantChatTitle } from "../chat.title";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const CHAT = "00000000-0000-4000-8000-000000000030";

async function titleModel() {
    const { MockLanguageModelV3 } = await import("ai/test");
    return new MockLanguageModelV3({
        doGenerate: async () => ({
            content: [{ type: "text", text: "Lease review" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
                inputTokens: { total: 60, noCache: 60, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
            warnings: [],
        }),
    });
}

const chat: UsageContext = {
    userId: USER,
    orgId: ORG,
    projectId: PROJECT,
    surface: "project_chat",
    chatId: CHAT,
};

beforeEach(async () => {
    inserts.length = 0;
    const model = await titleModel();
    completeWithProvider.mockImplementation((params: { user: string }) =>
        completeAiSdkText(params, { ...config(model), keySource: "org" }),
    );
});

describe("a chat title in the usage ledger", () => {
    it("is one row under the title surface, in the chat it names", async () => {
        await expect(
            generateAssistantChatTitle({
                model: "claude-haiku-4-5",
                message: "Review this lease",
                usage: chat,
            }),
        ).resolves.toBe("Lease review");
        await settleUsageWrites();
        expect(inserts).toEqual([
            expect.objectContaining({
                surface: "title",
                org_id: ORG,
                project_id: PROJECT,
                chat_id: CHAT,
                key_source: "org",
                input_tokens: 60,
                output_tokens: 3,
            }),
        ]);
    });

    it("takes the surrounding context when it is not given one", async () => {
        await runWithUsageContext(chat, () =>
            generateAssistantChatTitle({
                model: "claude-haiku-4-5",
                message: "Review this lease",
            }),
        );
        await settleUsageWrites();
        expect(inserts).toEqual([
            expect.objectContaining({ surface: "title", chat_id: CHAT }),
        ]);
    });
});
