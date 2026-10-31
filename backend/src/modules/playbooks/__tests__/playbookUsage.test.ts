// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

// A review goes through the real completion path down to the AI SDK
// adapter; only the provider is a scripted model and the ledger an
// in-memory list.
const { completeWithProvider, getUserApiKeys, inserts } = vi.hoisted(() => ({
  completeWithProvider: vi.fn(),
  getUserApiKeys: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/llm/providers", () => ({
  completeWithProvider: (params: unknown) => completeWithProvider(params),
  streamWithProvider: vi.fn(),
}));
vi.mock("../../user/user.service", () => ({ getUserApiKeys }));
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
import { settleUsageWrites } from "../../../lib/usage";
import {
  blankPlaybookContent,
  isPlaybookRefusal,
  PLAYBOOK_IMPORT_GENERIC_FAILURE,
  playbookImportFailureMessage,
  runFailureMessage,
  startPlaybookReview,
} from "../playbooks.operations";
import { DeploymentQuotaExceededError } from "../../../lib/usage";
import { playbookReviewUsage } from "../playbooks.usage";
import { database, type Row } from "./playbookTestDb";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const DOC = "00000000-0000-4000-8000-000000000060";
const VERSION = "00000000-0000-4000-8000-000000000061";

const book = (): Row => ({
  id: "book",
  user_id: OWNER,
  org_id: null,
  visibility: "private",
  shared_with: [],
  name: "Guide",
  description: "",
  content_json: blankPlaybookContent("Guide"),
  created_at: "2026-10-17",
  updated_at: "2026-10-17",
});

beforeEach(async () => {
  inserts.length = 0;
  getUserApiKeys.mockResolvedValue({ claude: "test-key" });
  const { MockLanguageModelV3 } = await import("ai/test");
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        { type: "text", text: JSON.stringify({ summary: "Reviewed", findings: [] }) },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 80, text: 80, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  completeWithProvider.mockImplementation((params: { user: string }) =>
    completeAiSdkText(params, { ...config(model), keySource: "user" }),
  );
});

describe("a playbook run in the usage ledger", () => {
  it("is one row under the playbook surface and the run", async () => {
    const { db } = database([book()]);
    const { run, done } = await startPlaybookReview({
      userId: OWNER,
      playbookId: "book",
      documentText: "Contract",
      documentName: "msa.txt",
      model: "claude-opus-5",
      reviewMode: "strict",
      db,
    });
    await expect(done).resolves.toMatchObject({ status: "completed" });
    await settleUsageWrites();

    expect(inserts).toEqual([
      expect.objectContaining({
        surface: "playbook",
        user_id: OWNER,
        org_id: null,
        project_id: null,
        run_id: run.id,
        key_source: "user",
        input_tokens: 900,
        output_tokens: 80,
      }),
    ]);
  });

  it("carries the reviewed document's matter and page count", async () => {
    const { db, tables } = database([]);
    tables.documents = [{ id: DOC, project_id: PROJECT }];
    tables.document_versions = [{ id: VERSION, page_count: 14 }];
    await expect(
      playbookReviewUsage(db, {
        userId: OWNER,
        orgId: null,
        runId: "run",
        documentId: DOC,
        versionId: VERSION,
      }),
    ).resolves.toMatchObject({
      surface: "playbook",
      projectId: PROJECT,
      documentId: DOC,
      documentPages: 14,
    });
  });

  it("never lets attribution fail a review", async () => {
    const broken = { from: () => { throw new Error("db down"); } } as never;
    await expect(
      playbookReviewUsage(broken, {
        userId: OWNER,
        orgId: null,
        runId: "run",
        documentId: DOC,
        versionId: VERSION,
      }),
    ).resolves.toMatchObject({ projectId: null, documentPages: null, documentId: DOC });
  });

  it("tells the user why a review over the deployment allowance stopped", () => {
    expect(runFailureMessage(new DeploymentQuotaExceededError("personal"))).toMatch(
      /reached this month's limit/,
    );
  });

  it("tells the user why an import over the deployment allowance stopped, instead of to try again", () => {
    const refusal = new DeploymentQuotaExceededError("organization");
    const message = playbookImportFailureMessage("compiling", refusal);
    expect(message).toBe(refusal.message);
    expect(message).not.toBe(PLAYBOOK_IMPORT_GENERIC_FAILURE);
    // Found under a wrapper too, and treated as a refusal, not a fault to report.
    const wrapped = new Error("compile failed", { cause: refusal });
    expect(playbookImportFailureMessage("compiling", wrapped)).toBe(refusal.message);
    expect(isPlaybookRefusal(wrapped)).toBe(true);
  });
});
