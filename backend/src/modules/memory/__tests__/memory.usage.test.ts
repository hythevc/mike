// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

// A memory.consolidate job for a Word conversation, run through the real job
// handler. The model, the memory files, the model settings and the database
// are fakes; what is checked is whose model use the curator call is, and what
// the job does when the deployment-key allowance refuses it.
const { stream, seen } = vi.hoisted(() => ({
    stream: vi.fn(),
    seen: [] as unknown[],
}));

vi.mock("../../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/llm")>()),
    streamChatWithTools: (params: unknown) => stream(params),
}));

const ACTOR = "00000000-0000-4000-8000-000000000001";
const CONVERSATION = "00000000-0000-4000-8000-000000000031";
const STATE = "00000000-0000-4000-8000-000000000032";
const FILE = {
    id: "00000000-0000-4000-8000-000000000033",
    scope: "user" as const,
    user_id: ACTOR,
    project_id: null,
    org_id: null,
    enabled: true,
    epoch: 1,
    revision: 3,
    learning_cutoff_at: "2026-01-01T00:00:00Z",
    content: "",
    content_sha256: null,
    size_bytes: 0,
    last_source_job_id: null,
    status: "scheduled" as const,
    last_error_code: null,
    last_source: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("../../../lib/memory/files", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/memory/files")>()),
    ensureMemoryFile: vi.fn(async () => FILE),
    getMemoryCurrentForFile: vi.fn(async () => ({
        current: { enabled: true, content: "", revision: 3 },
        file: FILE,
    })),
}));
vi.mock("../../user/user.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../user/user.service")>()),
    getUserModelSettings: vi.fn(async () => ({
        api_keys: {},
        last_selected_chat_model: null,
        memory_curator_model: null,
        personalisation: null,
    })),
}));
vi.mock("../../../lib/modelSelection", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/modelSelection")>()),
    resolveEffectiveChatModel: vi.fn(async () => ({ ok: true, model: "gpt-6.1-sol" })),
    hasApiKeyForModel: vi.fn(() => true),
}));
vi.mock("../../../lib/wordWorkspace", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/wordWorkspace")>()),
    wordChatHasWorkspaceAttachments: vi.fn(async () => false),
}));

import { currentUsageContext } from "../../../lib/llm/usageContext";
import { DeploymentQuotaExceededError } from "../../../lib/usage";
import { handleMemoryConsolidation } from "../memory.curator";

type Row = Record<string, unknown>;

/** Enough of PostgREST for the job: equality and membership filters only. */
function fakeDb(tables: Record<string, Row[]>) {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const upserts: Array<{ table: string; value: Row }> = [];
    const from = (table: string) => {
        const filters: Array<(row: Row) => boolean> = [];
        const rows = () =>
            (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
        const query: Record<string, unknown> = {};
        for (const method of ["select", "not", "gt", "order", "limit"]) {
            query[method] = () => query;
        }
        query.eq = (column: string, value: unknown) => {
            filters.push((row) => row[column] === value);
            return query;
        };
        query.is = (column: string, value: unknown) => {
            filters.push((row) => (row[column] ?? null) === value);
            return query;
        };
        query.in = (column: string, values: unknown[]) => {
            filters.push((row) => values.includes(row[column]));
            return query;
        };
        query.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
        query.upsert = async (value: Row) => {
            upserts.push({ table, value });
            return { error: null };
        };
        query.then = (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: rows(), error: null }).then(resolve);
        return query;
    };
    const db = {
        from,
        rpc: async (name: string, args: Row) => {
            rpcCalls.push({ name, args });
            return { data: name === "set_memory_consolidation_status", error: null };
        },
        auth: {
            admin: {
                getUserById: async () => ({
                    data: { user: { email: "actor@example.test" } },
                    error: null,
                }),
            },
        },
    };
    return { db, rpcCalls, upserts };
}

function wordConversation() {
    return fakeDb({
        memory_consolidation_states: [
            {
                id: STATE,
                surface: "word",
                conversation_id: CONVERSATION,
                actor_user_id: ACTOR,
                project_id: null,
                generation: 2,
                processed_generation: 1,
                latest_turn_id: null,
                status: "scheduled",
            },
        ],
        memory_conversation_activity: [
            {
                surface: "word",
                conversation_id: CONVERSATION,
                generation: 5,
                quiet_until: "2026-01-02T00:00:00Z",
                deleted_at: null,
            },
        ],
        word_chats: [{ id: CONVERSATION, user_id: ACTOR, model: "gpt-6.1-sol" }],
        word_chat_messages: [
            {
                id: "message-1",
                chat_id: CONVERSATION,
                role: "user",
                content: "Keep my summaries to one page.",
                author_user_id: ACTOR,
                memory_input_message_id: null,
                memory_eligible_at: null,
                memory_app_eligible_at: null,
                created_at: "2026-10-30T10:00:00Z",
            },
            {
                id: "message-2",
                chat_id: CONVERSATION,
                role: "assistant",
                content: "Understood.",
                author_user_id: ACTOR,
                memory_input_message_id: "message-1",
                memory_eligible_at: "2026-10-30T10:00:05Z",
                memory_app_eligible_at: "2026-10-30T10:00:05Z",
                created_at: "2026-10-30T10:00:05Z",
            },
        ],
    });
}

const job = {
    id: "00000000-0000-4000-8000-000000000034",
    kind: "memory.consolidate",
    payload: {
        stateId: STATE,
        generation: 2,
        conversationGeneration: 5,
        appEpoch: 1,
        sourceEpoch: 1,
        actorUserId: ACTOR,
    },
};

beforeEach(() => {
    seen.length = 0;
    stream.mockReset();
    stream.mockImplementation(async () => {
        seen.push(currentUsageContext());
        return { fullText: "" };
    });
});

describe("memory curation in the usage ledger", () => {
    it("runs the curator call under the memory surface, for the conversation's workspace", async () => {
        const { db } = wordConversation();

        const result = await handleMemoryConsolidation(db as never, job as never);

        expect(stream).toHaveBeenCalledTimes(1);
        expect(seen).toEqual([
            {
                userId: ACTOR,
                orgId: null,
                projectId: null,
                surface: "memory",
                chatId: CONVERSATION,
            },
        ]);
        expect(result).toMatchObject({ outcomes: { user: "no_change" } });
    });

    it("skips a scope the deployment-key allowance refuses, without failing or retrying the job", async () => {
        stream.mockRejectedValue(new DeploymentQuotaExceededError("personal"));
        const { db, rpcCalls, upserts } = wordConversation();

        // Resolving, not throwing: a thrown job is retried and reported.
        const result = await handleMemoryConsolidation(db as never, job as never);

        expect(result).toMatchObject({
            outcomes: { user: "deployment_quota_exceeded" },
        });
        expect(upserts).toEqual([
            {
                table: "memory_consolidation_results",
                value: expect.objectContaining({
                    job_id: job.id,
                    memory_file_id: FILE.id,
                    outcome: "skipped",
                }),
            },
        ]);
        // The run is over for this generation: idle, and marked processed.
        expect(rpcCalls).toContainEqual({
            name: "set_memory_consolidation_status",
            args: expect.objectContaining({
                p_status: "idle",
                p_mark_processed: true,
            }),
        });
    });
});
