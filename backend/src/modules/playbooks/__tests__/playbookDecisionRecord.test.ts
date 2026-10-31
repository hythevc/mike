// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybookFindingDecision } from "@mike/contracts";

const storage = vi.hoisted(() => ({
  uploadFile: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));
const documents = vi.hoisted(() => ({
  createDocumentVersion: vi.fn(),
}));

vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  storageEnabled: true,
  uploadFile: storage.uploadFile,
  deleteFile: storage.deleteFile,
}));
vi.mock("../../documents/documents.service", () => documents);

import { extractDocxBodyText } from "../../../lib/docxTrackedChanges";
import {
  blankPlaybookContent,
  type PlaybookFinding,
} from "../playbooks.operations";
import {
  buildPlaybookDecisionRecord,
  decisionRecordFilename,
  DECISION_RECORD_DISCLAIMER,
  exportPlaybookDecisionRecord,
  formatRecordTime,
} from "../playbooks.summaryExport";
import { database } from "./playbookTestDb";

const REVIEWER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000004";
const PLAYBOOK = "20000000-0000-4000-8000-000000000001";
const RUN = "30000000-0000-4000-8000-000000000001";
const DOCUMENT = "40000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000001";

function finding(overrides: Partial<PlaybookFinding>): PlaybookFinding {
  return {
    id: "finding",
    topicId: null,
    ruleId: "rule",
    ruleName: "Rule",
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

const FINDINGS = [
  finding({
    id: "indemnity",
    ruleName: "Indemnity",
    status: "unacceptable",
    matchedPosition: "none",
    quote: "The Supplier shall indemnify without limit.",
    location: "Clause 12.1",
    suggestedText: "Each party shall indemnify the other up to the cap.",
  }),
  finding({
    id: "cap",
    ruleName: "Liability cap",
    matchedPosition: "fallback",
    quote: "Liability is capped at twice the fees.",
    location: "Clause 9",
  }),
  finding({ id: "law", ruleName: "Governing law", quote: "New York law governs.", location: "Clause 20" }),
  finding({ id: "notices", ruleName: "Notices", quote: "Notices by email.", location: "Clause 21" }),
  finding({ id: "term", ruleName: "Term", status: "needs_review", matchedPosition: "none" }),
];

const jane = { userId: REVIEWER, displayName: "Jane Doe", email: "jane@example.com" };
const DECISIONS: PlaybookFindingDecision[] = [
  {
    findingId: "indemnity",
    decision: "overridden",
    method: "single",
    note: "Mutual indemnity agreed in the term sheet.",
    escalatedTo: null,
    decidedBy: jane,
    decidedAt: "2026-10-31T10:02:00.000Z",
  },
  {
    findingId: "cap",
    decision: "escalated",
    method: "single",
    note: null,
    escalatedTo: { userId: OTHER, displayName: "Sam Lee", email: "sam@example.com" },
    decidedBy: jane,
    decidedAt: "2026-10-31T10:04:00.000Z",
  },
  {
    findingId: "law",
    decision: "accepted",
    method: "bulk",
    note: null,
    escalatedTo: null,
    decidedBy: jane,
    decidedAt: "2026-10-31T10:06:00.000Z",
  },
  {
    findingId: "notices",
    decision: "accepted",
    method: "bulk",
    note: null,
    escalatedTo: null,
    decidedBy: jane,
    decidedAt: "2026-10-31T10:06:00.000Z",
  },
];

async function recordText(decisions = DECISIONS) {
  const bytes = await buildPlaybookDecisionRecord({
    documentName: "Supply agreement.docx",
    playbookName: "Commercial playbook",
    model: "claude-opus-5-5",
    reviewScope: "full",
    reviewMode: "strict",
    startedAt: "2026-10-30T09:00:00.000Z",
    exportedAt: "2026-10-31T11:00:00.000Z",
    findings: FINDINGS,
    decisions,
  });
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  return extractDocxBodyText(bytes);
}

/** The lines of the record from `heading` up to the next of `until`. */
function section(text: string, heading: string, until?: string) {
  const start = text.indexOf(heading);
  expect(start, `${heading} is in the record`).toBeGreaterThanOrEqual(0);
  const end = until ? text.indexOf(until, start + heading.length) : -1;
  return text.slice(start, end < 0 ? undefined : end);
}

describe("the decision record document", () => {
  it("names the document, playbook, model and scope of the review", async () => {
    const text = await recordText();
    for (const value of [
      "Supply agreement.docx",
      "Commercial playbook",
      "claude-opus-5-5",
      "Full review",
      "Strict",
      "30 Oct 2026, 09:00 UTC",
      "4 of 5 findings",
    ])
      expect(text).toContain(value);
  });

  it("lists every finding with its rule, status, quote, location, suggestion, decision, method, reviewer and time", async () => {
    const text = await recordText();
    for (const rule of ["Indemnity", "Liability cap", "Governing law", "Notices", "Term"])
      expect(text).toContain(rule);

    const indemnity = section(text, "Indemnity", "Liability cap");
    for (const value of [
      "Unacceptable",
      "Clause 12.1",
      "The Supplier shall indemnify without limit.",
      "Each party shall indemnify the other up to the cap.",
      "Overridden",
      "Individually",
      "Jane Doe",
      "31 Oct 2026, 10:02 UTC",
      "Mutual indemnity agreed in the term sheet.",
    ])
      expect(indemnity).toContain(value);

    const cap = section(text, "Liability cap", "Term");
    for (const value of ["Fallback", "Escalated", "Escalated to", "Sam Lee", "10:04 UTC"])
      expect(cap).toContain(value);

    // An undecided finding says so rather than leaving its decision out.
    expect(section(text, "Term", "Accepted in bulk")).toContain("Not decided");
  });

  it("puts bulk decisions in their own section with the count", async () => {
    const text = await recordText();
    const findings = section(text, "Findings (3)", "Accepted in bulk");
    const bulk = section(text, "Accepted in bulk (2 findings)");

    expect(findings).not.toContain("Governing law");
    expect(findings).not.toContain("Notices");
    for (const value of [
      "Governing law",
      "New York law governs.",
      "Clause 20",
      "Notices",
      "Standard",
      "Accepted",
      "In bulk",
      "Jane Doe",
      "31 Oct 2026, 10:06 UTC",
    ])
      expect(bulk).toContain(value);
  });

  it("is labelled an AI-generated draft with its reviewer, and carries the disclaimer", async () => {
    const text = await recordText();
    expect(text).toContain("AI-generated draft. Decisions recorded by Jane Doe.");
    expect(text).toContain("Legal information, not legal advice.");
    expect(text).toContain(DECISION_RECORD_DISCLAIMER);

    const undecided = await recordText([]);
    expect(undecided).toContain("AI-generated draft. No decisions have been recorded yet.");
    expect(undecided).toContain("Legal information, not legal advice.");
    expect(undecided).toContain("Accepted in bulk (0 findings)");
  });

  it("names a reviewer whose account is gone without inventing one", async () => {
    const text = await recordText([{ ...DECISIONS[0], decidedBy: null }]);
    expect(text).toContain("Decisions recorded by a deleted account.");
    expect(text).toContain("Deleted account");
  });

  it("keeps control characters out of the file", async () => {
    const bytes = await buildPlaybookDecisionRecord({
      documentName: "Odd\u0001name.docx",
      playbookName: "P",
      model: "m",
      reviewScope: "issues",
      reviewMode: "permissive",
      startedAt: "2026-10-30T09:00:00.000Z",
      exportedAt: "2026-10-31T11:00:00.000Z",
      findings: [finding({ id: "x", ruleName: "Rule\u0002", quote: "a\u0000b" })],
      decisions: [],
    });
    const text = await extractDocxBodyText(bytes);
    expect(text).toContain("Issues only");
    expect(text).toContain("Permissive");
    expect(text).toContain("ab");
  });

  it("formats times in one zone, and names its file after the document", () => {
    expect(formatRecordTime("2026-10-31T23:59:00.000Z")).toBe("31 Oct 2026, 23:59 UTC");
    expect(formatRecordTime("not a time")).toBe("Not recorded");
    expect(decisionRecordFilename("Supply agreement.docx")).toBe(
      "Supply agreement - decision record.docx",
    );
    expect(decisionRecordFilename('a/b:c*"d".pdf')).toBe("a b c d - decision record.docx");
    expect(decisionRecordFilename(null)).toBe("Playbook review - decision record.docx");
  });
});

function exportSetup(options: { projectOwner?: string; grantRole?: string; inProject?: boolean } = {}) {
  const fake = database(
    [
      {
        id: PLAYBOOK,
        user_id: REVIEWER,
        org_id: null,
        visibility: "private",
        name: "Commercial playbook (renamed)",
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
      findings_json: FINDINGS,
      started_at: "2026-10-30T09:00:00.000Z",
      completed_at: "2026-10-30T09:01:00.000Z",
      playbook_name: "Commercial playbook",
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
      user_id: options.projectOwner ?? REVIEWER,
      org_id: null,
      visibility: "private",
      archived_at: null,
      name: "Acme supply matter",
    },
  ];
  fake.tables.project_access_grants = options.grantRole
    ? [{ id: "g", project_id: PROJECT, email: "jane@example.com", role: options.grantRole }]
    : [];
  fake.tables.playbook_finding_decisions = [
    {
      run_id: RUN,
      finding_key: "law",
      decision: "accepted",
      method: "bulk",
      note: null,
      escalated_to: null,
      decided_by: REVIEWER,
      decided_at: "2026-10-31T10:06:00.000Z",
    },
  ];
  return fake;
}

const caller = {
  userId: REVIEWER,
  userEmail: "jane@example.com",
  runId: RUN,
  now: new Date("2026-10-31T11:00:00.000Z"),
};

describe("exporting a run's decision record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents.createDocumentVersion.mockResolvedValue({
      data: { id: "version-1", version_number: 1 },
      error: null,
    });
  });

  it("saves it to the reviewed document's project through the documents facade", async () => {
    const { db, tables } = exportSetup();

    const result = await exportPlaybookDecisionRecord(db, caller);

    expect(result).toMatchObject({
      ok: true,
      data: {
        kind: "saved",
        saved: {
          projectId: PROJECT,
          projectName: "Acme supply matter",
          filename: "Supply agreement - decision record.docx",
        },
      },
    });
    const saved = result.ok && result.data.kind === "saved" ? result.data.saved : null;
    expect(tables.documents).toContainEqual(
      expect.objectContaining({
        id: saved?.documentId,
        project_id: PROJECT,
        user_id: REVIEWER,
        status: "ready",
      }),
    );
    expect(storage.uploadFile).toHaveBeenCalledWith(
      `generated/${REVIEWER}/${saved?.documentId}/generated.docx`,
      expect.any(ArrayBuffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(documents.createDocumentVersion).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        document_id: saved?.documentId,
        source: "generated",
        file_type: "docx",
        filename: "Supply agreement - decision record.docx",
        storage_path: `generated/${REVIEWER}/${saved?.documentId}/generated.docx`,
      }),
    );
    // The record names the playbook as the run reviewed it.
    const [, bytes] = storage.uploadFile.mock.calls[0] as unknown as [string, ArrayBuffer];
    const text = await extractDocxBodyText(Buffer.from(bytes));
    expect(text).toContain("Commercial playbook");
    expect(text).not.toContain("(renamed)");
    expect(text).toContain("AI-generated draft. Decisions recorded by Jane Doe.");
  });

  it("downloads it when the document is in no project, or one the reviewer cannot add to", async () => {
    for (const options of [
      { inProject: false },
      { projectOwner: OTHER, grantRole: "viewer" },
    ]) {
      const { db, tables } = exportSetup(options);
      const before = tables.documents.length;

      const result = await exportPlaybookDecisionRecord(db, caller);

      expect(result).toMatchObject({
        ok: true,
        data: { kind: "download", filename: "Supply agreement - decision record.docx" },
      });
      if (result.ok && result.data.kind === "download")
        expect(result.data.bytes.subarray(0, 2).toString()).toBe("PK");
      expect(tables.documents).toHaveLength(before);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    }
  });

  it("removes the uploaded file and the document when its version cannot be created", async () => {
    const { db, tables } = exportSetup();
    documents.createDocumentVersion.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "conflict" },
    });

    const result = await exportPlaybookDecisionRecord(db, caller);

    expect(result).toMatchObject({ ok: false, kind: "error" });
    expect(tables.documents.map((row) => row.id)).toEqual([DOCUMENT]);
    expect(storage.deleteFile).toHaveBeenCalledWith(
      (storage.uploadFile.mock.calls[0] as unknown as [string])[0],
    );
  });

  it("is refused for a run the caller cannot open, and for an unfinished run", async () => {
    const { db } = exportSetup();
    expect(
      await exportPlaybookDecisionRecord(db, { ...caller, userId: OTHER }),
    ).toEqual({ ok: false, kind: "not_found", detail: "Run not found." });

    const running = exportSetup();
    running.tables.playbook_runs[0].status = "running";
    expect(await exportPlaybookDecisionRecord(running.db, caller)).toMatchObject({
      ok: false,
      kind: "conflict",
    });
  });
});
