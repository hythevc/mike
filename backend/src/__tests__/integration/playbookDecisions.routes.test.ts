// SPDX-License-Identifier: AGPL-3.0-only
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  userId: "",
  userEmail: "",
}));
const storage = vi.hoisted(() => ({
  uploadFile: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));
const documents = vi.hoisted(() => ({ createDocumentVersion: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
  createServerSupabase: () => state.db,
}));
vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = state.userId;
    res.locals.userEmail = state.userEmail;
    next();
  },
  requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock("../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage")>()),
  storageEnabled: true,
  uploadFile: storage.uploadFile,
  deleteFile: storage.deleteFile,
}));
vi.mock("../../modules/documents/documents.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../modules/documents/documents.service")
  >()),
  createDocumentVersion: documents.createDocumentVersion,
}));

import { playbooksRouter } from "../../modules/playbooks/playbooks.routes";
import { blankPlaybookContent } from "../../modules/playbooks/playbooks.service";
import { database } from "../../modules/playbooks/__tests__/playbookTestDb";

const REVIEWER = "10000000-0000-4000-8000-000000000001";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";
const PLAYBOOK = "20000000-0000-4000-8000-000000000001";
const RUN = "30000000-0000-4000-8000-000000000001";
const DOCUMENT = "40000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000001";

const app = express();
app.use(express.json());
app.use("/playbooks", playbooksRouter);

function finding(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    topicId: null,
    ruleId: id,
    ruleName: `Rule ${id}`,
    status: "acceptable",
    matchedPosition: "standard",
    quote: "",
    location: "",
    analysis: "Meets the playbook.",
    suggestedText: "",
    insertAfter: "",
    ...overrides,
  };
}

function seed(options: { inProject?: boolean } = {}) {
  const fake = database(
    [
      {
        id: PLAYBOOK,
        user_id: REVIEWER,
        org_id: null,
        visibility: "private",
        name: "Commercial playbook",
        description: "",
        content_json: blankPlaybookContent("Commercial playbook"),
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    [],
    [{ user_id: REVIEWER, email: "jane@example.com", display_name: "Jane Doe" }],
  );
  fake.tables.playbook_runs = [
    {
      id: RUN,
      playbook_id: PLAYBOOK,
      user_id: REVIEWER,
      document_id: DOCUMENT,
      document_name: "Supply agreement.docx",
      model: "claude-opus-5-5",
      review_mode: "strict",
      review_scope: "full",
      status: "completed",
      findings_json: [
        finding("law"),
        finding("cap", { matchedPosition: "fallback" }),
        finding("indemnity", { status: "unacceptable", matchedPosition: "none" }),
      ],
      started_at: "2026-10-30T09:00:00.000Z",
      completed_at: "2026-10-30T09:01:00.000Z",
    },
  ];
  fake.tables.documents = [
    {
      id: DOCUMENT,
      project_id: options.inProject === false ? null : PROJECT,
      user_id: REVIEWER,
    },
  ];
  fake.tables.projects = [
    {
      id: PROJECT,
      user_id: REVIEWER,
      org_id: null,
      visibility: "private",
      archived_at: null,
      name: "Acme supply matter",
    },
  ];
  fake.tables.project_access_grants = [];
  fake.tables.playbook_finding_decisions = [];
  fake.tables.audit_events = [];
  state.db = fake.db;
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = REVIEWER;
  state.userEmail = "jane@example.com";
  documents.createDocumentVersion.mockResolvedValue({
    data: { id: "version-1", version_number: 1 },
    error: null,
  });
});

describe("playbook decision routes", () => {
  it("record, change and clear a decision", async () => {
    const { tables } = seed();

    const accepted = await request(app)
      .put(`/playbooks/runs/${RUN}/decisions/law`)
      .send({ decision: "accepted" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      findingId: "law",
      decision: "accepted",
      method: "single",
      decidedBy: { userId: REVIEWER, displayName: "Jane Doe" },
    });

    const overridden = await request(app)
      .put(`/playbooks/runs/${RUN}/decisions/law`)
      .send({ decision: "overridden", note: "Agreed with the client." });
    expect(overridden.status).toBe(200);
    expect(overridden.body).toMatchObject({
      decision: "overridden",
      note: "Agreed with the client.",
    });
    expect(tables.playbook_finding_decisions).toHaveLength(1);

    const listed = await request(app).get(`/playbooks/runs/${RUN}/decisions`);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      runId: RUN,
      project: { id: PROJECT, name: "Acme supply matter", canAddDocuments: true },
      decisions: [{ findingId: "law", decision: "overridden" }],
    });

    const cleared = await request(app).delete(
      `/playbooks/runs/${RUN}/decisions/law`,
    );
    expect(cleared.status).toBe(204);
    expect(tables.playbook_finding_decisions).toEqual([]);
  });

  it("gives a user who cannot open the run the existing 404", async () => {
    seed();
    state.userId = OUTSIDER;
    state.userEmail = "out@example.com";

    for (const call of [
      request(app).get(`/playbooks/runs/${RUN}/decisions`),
      request(app)
        .put(`/playbooks/runs/${RUN}/decisions/law`)
        .send({ decision: "accepted" }),
      request(app).delete(`/playbooks/runs/${RUN}/decisions/law`),
      request(app)
        .post(`/playbooks/runs/${RUN}/decisions/bulk-accept`)
        .send({ findingIds: ["law"] }),
      request(app).get(`/playbooks/runs/${RUN}/escalation-members`),
      request(app).post(`/playbooks/runs/${RUN}/decision-record`),
    ]) {
      const response = await call;
      expect(response.status).toBe(404);
      // The body DELETE /playbooks/runs/:runId answers for a run it cannot find.
      expect(response.body).toEqual({ detail: "Run not found." });
    }
  });

  it("rejects an override without a note", async () => {
    const { tables } = seed();

    const response = await request(app)
      .put(`/playbooks/runs/${RUN}/decisions/indemnity`)
      .send({ decision: "overridden", note: " " });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      detail: "Add a note saying why you are overriding this finding.",
    });
    expect(tables.playbook_finding_decisions).toEqual([]);
  });

  it("bulk-accepts standard matches and refuses a fallback match", async () => {
    const { tables } = seed();

    const refused = await request(app)
      .post(`/playbooks/runs/${RUN}/decisions/bulk-accept`)
      .send({ findingIds: ["law", "cap"] });
    expect(refused.status).toBe(400);
    expect(tables.playbook_finding_decisions).toEqual([]);

    const accepted = await request(app)
      .post(`/playbooks/runs/${RUN}/decisions/bulk-accept`)
      .send({ findingIds: ["law"] });
    expect(accepted.status).toBe(200);
    expect(accepted.body.decisions).toEqual([
      expect.objectContaining({ findingId: "law", decision: "accepted", method: "bulk" }),
    ]);
  });

  it("saves the decision record to the document's project", async () => {
    const { tables } = seed();

    const response = await request(app).post(
      `/playbooks/runs/${RUN}/decision-record`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      saved: {
        documentId: expect.any(String),
        projectId: PROJECT,
        projectName: "Acme supply matter",
        filename: "Supply agreement - decision record.docx",
      },
    });
    expect(tables.documents).toContainEqual(
      expect.objectContaining({ id: response.body.saved.documentId, project_id: PROJECT }),
    );
    expect(documents.createDocumentVersion).toHaveBeenCalledTimes(1);
  });

  it("downloads the decision record when the document is not in a project", async () => {
    seed({ inProject: false });

    const response = await request(app)
      .post(`/playbooks/runs/${RUN}/decision-record`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain(
      "Supply agreement - decision record.docx",
    );
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
});
