// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

// The turn's model calls go through the real AI SDK adapter (llm/aiSdk.ts),
// which records each call in the usage ledger; only the provider is a
// scripted model, and the ledger table an in-memory list.
const { streamChatWithTools, inserts, control } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  control: { failLedger: false },
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: unknown) => streamChatWithTools(params),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({ buildUserMcpTools: async () => [] }));
vi.mock("../../../../lib/supabase", () => ({
  createServerSupabase: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "usage_events") inserts.push(row);
        return control.failLedger
          ? { error: { message: "ledger unavailable" } }
          : { error: null };
      },
    }),
  }),
}));

import type { DelegationEvent } from "@mike/contracts";
import { streamAiSdk } from "../../../../lib/llm/aiSdk";
import type { StreamChatParams } from "../../../../lib/llm/types";
import type { UsageContext } from "../../../../lib/llm/usageContext";
import { settleUsageWrites } from "../../../../lib/usage";
import {
  callStep,
  config,
  makeModel,
  textStep,
} from "../../../../lib/llm/__tests__/mockLanguageModel";
import {
  AssistantStreamError,
  assistantStreamErrorPayload,
  runLLMStream,
} from "../streaming";
import { DeploymentQuotaExceededError } from "../../../../lib/usage";

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const CHAT = "00000000-0000-4000-8000-000000000030";

const turnUsage: UsageContext = {
  userId: USER,
  orgId: null,
  projectId: PROJECT,
  surface: "chat",
  chatId: CHAT,
};

const baseParams = () => ({
  model: "gemini-3.8-flash",
  apiMessages: [
    { role: "system", content: "Base prompt." },
    { role: "user", content: "Review the lease." },
  ],
  docStore: new Map(),
  docIndex: {},
  userId: USER,
  db: {} as never,
  write: vi.fn(),
  nonce: "turnnonce",
});

const isSubagent = (params: StreamChatParams) =>
  params.systemPrompt.includes("SUBAGENT:");

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  control.failLedger = false;
});

describe("usage recorded for a chat turn", () => {
  it("writes one row for the turn, under the surface, matter and chat it was given", async () => {
    const model = await makeModel([textStep("Answer")]);
    streamChatWithTools.mockImplementation((params: StreamChatParams) =>
      streamAiSdk(params, { ...config(model), keySource: "user" }),
    );

    const result = await runLLMStream({ ...baseParams(), usage: turnUsage });
    await settleUsageWrites();

    expect(result.fullText).toBe("Answer");
    expect(inserts).toEqual([
      expect.objectContaining({
        surface: "chat",
        project_id: PROJECT,
        chat_id: CHAT,
        user_id: USER,
        key_source: "user",
        run_id: null,
      }),
    ]);
  });

  it("finishes the turn when the ledger write fails", async () => {
    control.failLedger = true;
    const model = await makeModel([textStep("Answer")]);
    streamChatWithTools.mockImplementation((params: StreamChatParams) =>
      streamAiSdk(params, config(model)),
    );

    const result = await runLLMStream({ ...baseParams(), usage: turnUsage });
    await settleUsageWrites();

    expect(result.fullText).toBe("Answer");
    expect(result.events.some((event) => event.type === "error")).toBe(false);
    expect(inserts).toHaveLength(1);
  });

  it("writes a subagent's call as its own row, under its delegation", async () => {
    const parent = await makeModel([
      callStep("d1", "delegate", { title: "Task d1", task: "Summarise doc-0." }),
      textStep("Answer"),
    ]);
    const subagent = await makeModel([textStep("Brief from the subagent.")]);
    streamChatWithTools.mockImplementation((params: StreamChatParams) =>
      streamAiSdk(params, {
        ...config(isSubagent(params) ? subagent : parent),
        keySource: "env",
      }),
    );

    const result = await runLLMStream({
      ...baseParams(),
      usage: turnUsage,
      subagentRuns: { save: vi.fn(), load: vi.fn(async () => null) },
    });
    await settleUsageWrites();

    const [delegation] = result.events.filter(
      (event): event is DelegationEvent => event.type === "delegation",
    );
    expect(delegation?.status).toBe("completed");
    const bySurface = (surface: string) =>
      inserts.filter((row) => row.surface === surface);
    expect(bySurface("subagent")).toEqual([
      expect.objectContaining({
        run_id: delegation.delegation_id,
        chat_id: CHAT,
        project_id: PROJECT,
        key_source: "env",
      }),
    ]);
    expect(bySurface("chat")).toEqual([
      expect.objectContaining({ run_id: null, chat_id: CHAT }),
    ]);
    expect(inserts).toHaveLength(2);
  });

  it("ends a turn refused for the deployment allowance with its code, safe to show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    streamChatWithTools.mockRejectedValue(new DeploymentQuotaExceededError("personal"));

    const failure = await runLLMStream({ ...baseParams(), usage: turnUsage }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AssistantStreamError);
    const expected = {
      code: "deployment_quota_exceeded",
      safe_to_display: true,
      message: expect.stringContaining("reached this month's limit"),
    };
    expect((failure as AssistantStreamError).events).toEqual([
      { type: "error", ...expected },
    ]);
    expect(assistantStreamErrorPayload(failure)).toMatchObject(expected);
    // Raised straight from the provider layer, as a tabular row sees it.
    expect(
      assistantStreamErrorPayload(new DeploymentQuotaExceededError("organization")),
    ).toMatchObject({ ...expected, message: expect.stringContaining("This organization") });
    expect(inserts).toEqual([]);
  });
});
