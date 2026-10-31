// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  get storageEnabled() {
    return storage.enabled;
  },
}));

import {
  BULK_ACCEPT_REFUSED,
  bulkAcceptableFindings,
  bulkAcceptPlaybookFindings,
  clearPlaybookFindingDecision,
  getPlaybookRunDecisions,
  listPlaybookEscalationMembers,
  NO_PROJECT_FOR_ESCALATION,
  OVERRIDE_NOTE_REQUIRED,
  recordPlaybookFindingDecision,
  RUN_NOT_FOUND,
} from "../playbooks.decisions";
import {
  blankPlaybookContent,
  storedPlaybookFindings,
  type PlaybookFinding,
} from "../playbooks.operations";
import { database, ORG, type Row } from "./playbookTestDb";

const REVIEWER = "10000000-0000-4000-8000-000000000001";
const COLLEAGUE = "10000000-0000-4000-8000-000000000002";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000004";
const PLAYBOOK = "20000000-0000-4000-8000-000000000001";
const RUN = "30000000-0000-4000-8000-000000000001";
const DOCUMENT = "40000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000001";
const PRIVATE_NOTE = "Client accepted this cap on the 12 October call.";

function finding(overrides: Partial<PlaybookFinding>): PlaybookFinding {
  return {
    id: "finding",
    topicId: null,
    ruleId: "rule",
    ruleName: "Rule",
    status: "acceptable",
    matchedPosition: "standard",
    quote: "Quoted contract language.",
    location: "Clause 1",
    analysis: "Meets the playbook.",
    suggestedText: "",
    insertAfter: "",
    ...overrides,
  };
}

const FINDINGS: PlaybookFinding[] = [
  finding({ id: "law", ruleName: "Governing law" }),
  finding({ id: "cap", ruleName: "Liability cap", matchedPosition: "fallback" }),
  finding({
    id: "indemnity",
    ruleName: "Indemnity",
    status: "unacceptable",
    matchedPosition: "none",
    suggestedText: "Each party indemnifies the other.",
  }),
  finding({ id: "notices", ruleName: "Notices" }),
  finding({ id: "term", ruleName: "Term", status: "needs_review" }),
];

function setup(
  options: {
    run?: Partial<Row>;
    playbookOwner?: string;
    document?: Row | null;
    project?: Partial<Row>;
  } = {},
) {
  const playbook = {
    id: PLAYBOOK,
    user_id: options.playbookOwner ?? REVIEWER,
    org_id: null,
    visibility: "private",
    name: "Commercial playbook",
    description: "",
    content_json: blankPlaybookContent("Commercial playbook"),
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
  const fake = database(
    [playbook],
    [],
    [
      { user_id: REVIEWER, email: "jane@example.com", display_name: "Jane Doe" },
      { user_id: COLLEAGUE, email: "sam@example.com", display_name: "Sam Lee" },
      { user_id: OUTSIDER, email: "out@example.com", display_name: "Outsider" },
    ],
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
      ...options.run,
    },
  ];
  fake.tables.documents =
    options.document === null
      ? []
      : [options.document ?? { id: DOCUMENT, project_id: PROJECT, user_id: REVIEWER }];
  fake.tables.projects = [
    {
      id: PROJECT,
      user_id: REVIEWER,
      org_id: null,
      visibility: "private",
      archived_at: null,
      name: "Acme supply matter",
      ...options.project,
    },
  ];
  fake.tables.project_access_grants = [
    {
      id: "grant-1",
      project_id: PROJECT,
      email: "sam@example.com",
      role: "viewer",
      created_at: "2026-10-01T00:00:00.000Z",
    },
  ];
  fake.tables.playbook_finding_decisions = [];
  fake.tables.audit_events = [];
  return fake;
}

const reviewer = { userId: REVIEWER, userEmail: "jane@example.com", runId: RUN };

describe("recording a decision on a finding", () => {
  it("records, changes and clears a decision, one row per finding", async () => {
    const { db, tables } = setup();

    const accepted = await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "law",
      decision: "accepted",
    });
    expect(accepted).toMatchObject({
      ok: true,
      data: {
        findingId: "law",
        decision: "accepted",
        method: "single",
        note: null,
        escalatedTo: null,
        decidedBy: {
          userId: REVIEWER,
          displayName: "Jane Doe",
          email: "jane@example.com",
        },
      },
    });
    expect(tables.playbook_finding_decisions).toEqual([
      expect.objectContaining({
        run_id: RUN,
        finding_key: "law",
        decision: "accepted",
        method: "single",
        decided_by: REVIEWER,
        decided_at: expect.any(String),
      }),
    ]);

    // Changing it replaces the decision instead of adding a second one.
    const overridden = await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "law",
      decision: "overridden",
      note: `  ${PRIVATE_NOTE}  `,
    });
    expect(overridden).toMatchObject({
      ok: true,
      data: { decision: "overridden", method: "single", note: PRIVATE_NOTE },
    });
    expect(tables.playbook_finding_decisions).toHaveLength(1);
    expect(tables.playbook_finding_decisions[0]).toMatchObject({
      decision: "overridden",
      note: PRIVATE_NOTE,
    });

    const cleared = await clearPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "law",
    });
    expect(cleared).toEqual({ ok: true, data: null });
    expect(tables.playbook_finding_decisions).toEqual([]);

    const listed = await getPlaybookRunDecisions(db, reviewer);
    expect(listed).toMatchObject({
      ok: true,
      data: { runId: RUN, decisions: [] },
    });
  });

  it("answers the run's 404 to anyone who cannot open the run", async () => {
    const attempts = [
      // Someone else's run.
      { ...reviewer, userId: OUTSIDER, userEmail: "out@example.com" },
      // A run that does not exist, and an id that cannot be one.
      { ...reviewer, runId: "30000000-0000-4000-8000-000000000999" },
      { ...reviewer, runId: "not-a-run" },
    ];
    for (const caller of attempts) {
      const { db, tables } = setup();
      for (const result of [
        await recordPlaybookFindingDecision(db, {
          ...caller,
          findingId: "law",
          decision: "accepted",
        }),
        await clearPlaybookFindingDecision(db, { ...caller, findingId: "law" }),
        await getPlaybookRunDecisions(db, caller),
        await bulkAcceptPlaybookFindings(db, { ...caller, findingIds: ["law"] }),
        await listPlaybookEscalationMembers(db, caller),
      ])
        expect(result).toEqual({
          ok: false,
          kind: "not_found",
          detail: RUN_NOT_FOUND,
        });
      expect(tables.playbook_finding_decisions).toEqual([]);
      expect(tables.audit_events).toEqual([]);
    }
  });

  it("answers the same 404 once the reviewer can no longer open the run's playbook", async () => {
    // The playbook belonged to someone else and is no longer shared.
    const { db, tables } = setup({ playbookOwner: OTHER_OWNER });

    const result = await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "law",
      decision: "accepted",
    });

    expect(result).toEqual({ ok: false, kind: "not_found", detail: RUN_NOT_FOUND });
    expect(tables.playbook_finding_decisions).toEqual([]);
  });

  it("rejects an override without a note", async () => {
    for (const note of [undefined, "", "   "]) {
      const { db, tables } = setup();

      const result = await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "indemnity",
        decision: "overridden",
        note,
      });

      expect(result).toEqual({
        ok: false,
        kind: "validation",
        detail: OVERRIDE_NOTE_REQUIRED,
      });
      expect(tables.playbook_finding_decisions).toEqual([]);
      expect(tables.audit_events).toEqual([]);
    }
  });

  it("refuses an unknown decision, an unknown finding and an unfinished run", async () => {
    const { db } = setup();
    expect(
      await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "law",
        decision: "approved",
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(
      await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "missing",
        decision: "accepted",
      }),
    ).toMatchObject({ ok: false, kind: "not_found", detail: "Finding not found." });
    expect(
      await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "law",
        decision: "accepted",
        note: "x".repeat(4_001),
      }),
    ).toMatchObject({ ok: false, kind: "validation" });

    const running = setup({ run: { status: "running", findings_json: [] } });
    expect(
      await recordPlaybookFindingDecision(running.db, {
        ...reviewer,
        findingId: "law",
        decision: "accepted",
      }),
    ).toMatchObject({ ok: false, kind: "conflict" });
  });

  it("audits each decision as playbook.decision with ids and codes only", async () => {
    const { db, tables } = setup();

    await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "indemnity",
      decision: "escalated",
      escalatedTo: COLLEAGUE,
      note: PRIVATE_NOTE,
    });
    await clearPlaybookFindingDecision(db, { ...reviewer, findingId: "indemnity" });

    expect(tables.audit_events).toHaveLength(2);
    const [escalated, cleared] = tables.audit_events;
    expect(escalated).toMatchObject({
      user_id: REVIEWER,
      action: "playbook.decision",
      surface: "playbooks",
      status: "completed",
      title: null,
      document_id: DOCUMENT,
      detail: {
        playbook_id: PLAYBOOK,
        run_id: RUN,
        finding_id: "indemnity",
        decision: "escalated",
        method: "single",
        escalated_to: COLLEAGUE,
      },
    });
    expect(cleared).toMatchObject({
      action: "playbook.decision",
      detail: { finding_id: "indemnity", decision: "cleared", method: "single" },
    });
    for (const row of tables.audit_events) {
      // Only ids and closed-vocabulary codes in the detail.
      expect(Object.keys(row.detail as object).sort()).toEqual(
        expect.arrayContaining(["decision", "method", "playbook_id", "run_id"]),
      );
      for (const [key, value] of Object.entries(row.detail as object)) {
        expect(
          ["playbook_id", "run_id", "finding_id", "decision", "method", "escalated_to"],
        ).toContain(key);
        expect(typeof value).toBe("string");
      }
      // No note, finding text, names or the colleague's email anywhere.
      const serialized = JSON.stringify(row);
      for (const text of [
        PRIVATE_NOTE,
        "Indemnity",
        "Each party indemnifies",
        "Sam Lee",
        "sam@example.com",
        "Commercial playbook",
      ])
        expect(serialized).not.toContain(text);
    }
  });

  it("does not audit clearing a finding that had no decision", async () => {
    const { db, tables } = setup();
    expect(
      await clearPlaybookFindingDecision(db, { ...reviewer, findingId: "law" }),
    ).toEqual({ ok: true, data: null });
    expect(tables.audit_events).toEqual([]);
  });
});

describe("escalating a finding", () => {
  it("names a member of the reviewed document's project", async () => {
    const { db, tables } = setup();

    expect(await listPlaybookEscalationMembers(db, reviewer)).toEqual({
      ok: true,
      // The reviewer is not offered to themselves.
      data: [{ userId: COLLEAGUE, displayName: "Sam Lee", email: "sam@example.com" }],
    });
    const escalated = await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "indemnity",
      decision: "escalated",
      escalatedTo: COLLEAGUE,
    });
    expect(escalated).toMatchObject({
      ok: true,
      data: {
        decision: "escalated",
        escalatedTo: { userId: COLLEAGUE, displayName: "Sam Lee" },
      },
    });
    expect(tables.playbook_finding_decisions[0]).toMatchObject({
      escalated_to: COLLEAGUE,
    });
  });

  it("offers the members of an organization project, never one denied it", async () => {
    const { db, tables } = setup({
      project: { org_id: ORG, visibility: "organization" },
    });
    tables.org_members = [
      { org_id: ORG, user_id: REVIEWER, role: "member" },
      { org_id: ORG, user_id: COLLEAGUE, role: "member" },
      { org_id: ORG, user_id: OUTSIDER, role: "member" },
    ];
    tables.project_org_access_overrides = [
      {
        id: "override-1",
        project_id: PROJECT,
        org_id: ORG,
        user_id: OUTSIDER,
        role: "deny",
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ];

    expect(await listPlaybookEscalationMembers(db, reviewer)).toEqual({
      ok: true,
      data: [{ userId: COLLEAGUE, displayName: "Sam Lee", email: "sam@example.com" }],
    });
    expect(
      await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "indemnity",
        decision: "escalated",
        escalatedTo: OUTSIDER,
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
  });

  it("refuses someone outside the project, and a run with no project", async () => {
    const { db, tables } = setup();
    expect(
      await recordPlaybookFindingDecision(db, {
        ...reviewer,
        findingId: "indemnity",
        decision: "escalated",
        escalatedTo: OUTSIDER,
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(tables.playbook_finding_decisions).toEqual([]);

    for (const fake of [
      setup({ run: { document_id: null } }),
      setup({ document: { id: DOCUMENT, project_id: null, user_id: REVIEWER } }),
      setup({ project: { archived_at: "2026-10-30T00:00:00.000Z" } }),
    ]) {
      expect(await listPlaybookEscalationMembers(fake.db, reviewer)).toEqual({
        ok: false,
        kind: "conflict",
        detail: NO_PROJECT_FOR_ESCALATION,
      });
      expect(
        await recordPlaybookFindingDecision(fake.db, {
          ...reviewer,
          findingId: "indemnity",
          decision: "escalated",
          escalatedTo: COLLEAGUE,
        }),
      ).toMatchObject({ ok: false, kind: "conflict" });
      expect(await getPlaybookRunDecisions(fake.db, reviewer)).toMatchObject({
        ok: true,
        data: { project: null },
      });
    }
  });

  it("reports the project, and whether the reviewer can add documents to it", async () => {
    const { db } = setup();
    expect(await getPlaybookRunDecisions(db, reviewer)).toMatchObject({
      ok: true,
      data: {
        project: { id: PROJECT, name: "Acme supply matter", canAddDocuments: true },
      },
    });

    // Without file storage nothing can be added, so no record is saved there.
    storage.enabled = false;
    try {
      expect(await getPlaybookRunDecisions(db, reviewer)).toMatchObject({
        ok: true,
        data: { project: { id: PROJECT, canAddDocuments: false } },
      });
    } finally {
      storage.enabled = true;
    }
  });
});

describe("accepting matching findings", () => {
  it("offers exactly the undecided acceptable findings that met the standard position", () => {
    expect(bulkAcceptableFindings(FINDINGS).map((item) => item.id)).toEqual([
      "law",
      "notices",
    ]);
    expect(
      bulkAcceptableFindings(FINDINGS, new Set(["law"])).map((item) => item.id),
    ).toEqual(["notices"]);
  });

  it("stores each one with method bulk and the reviewer, in one audited action", async () => {
    const { db, tables } = setup();

    const result = await bulkAcceptPlaybookFindings(db, {
      ...reviewer,
      findingIds: ["law", "notices"],
    });

    expect(result.ok).toBe(true);
    expect(tables.playbook_finding_decisions).toEqual([
      expect.objectContaining({
        finding_key: "law",
        decision: "accepted",
        method: "bulk",
        decided_by: REVIEWER,
      }),
      expect.objectContaining({
        finding_key: "notices",
        decision: "accepted",
        method: "bulk",
        decided_by: REVIEWER,
      }),
    ]);
    if (result.ok)
      expect(result.data.decisions).toEqual([
        expect.objectContaining({
          findingId: "law",
          method: "bulk",
          decidedBy: expect.objectContaining({ displayName: "Jane Doe" }),
        }),
        expect.objectContaining({ findingId: "notices", method: "bulk" }),
      ]);
    expect(tables.audit_events).toEqual([
      expect.objectContaining({
        action: "playbook.decision",
        title: null,
        detail: {
          playbook_id: PLAYBOOK,
          run_id: RUN,
          finding_ids: ["law", "notices"],
          count: 2,
          decision: "accepted",
          method: "bulk",
        },
      }),
    ]);
  });

  it("never accepts a fallback match, or any finding that is not acceptable", async () => {
    for (const ids of [["cap"], ["law", "cap"], ["term"], ["indemnity"]]) {
      const { db, tables } = setup();
      expect(
        await bulkAcceptPlaybookFindings(db, { ...reviewer, findingIds: ids }),
      ).toEqual({ ok: false, kind: "validation", detail: BULK_ACCEPT_REFUSED });
      expect(tables.playbook_finding_decisions).toEqual([]);
      expect(tables.audit_events).toEqual([]);
    }
  });

  it("leaves a finding decided meanwhile with its own decision", async () => {
    const { db, tables } = setup();
    await recordPlaybookFindingDecision(db, {
      ...reviewer,
      findingId: "law",
      decision: "overridden",
      note: PRIVATE_NOTE,
    });

    await bulkAcceptPlaybookFindings(db, {
      ...reviewer,
      findingIds: ["law", "notices"],
    });

    expect(tables.playbook_finding_decisions).toEqual([
      expect.objectContaining({ finding_key: "law", decision: "overridden", method: "single" }),
      expect.objectContaining({ finding_key: "notices", decision: "accepted", method: "bulk" }),
    ]);
    expect(tables.audit_events.at(-1)).toMatchObject({
      detail: { finding_ids: ["notices"], count: 1, method: "bulk" },
    });
  });

  it("refuses an empty or malformed list", async () => {
    const { db } = setup();
    for (const findingIds of [[], undefined, "law", [1]])
      expect(
        await bulkAcceptPlaybookFindings(db, { ...reviewer, findingIds }),
      ).toMatchObject({ ok: false, kind: "validation" });
  });
});

describe("findings read from a stored run", () => {
  it("reads a run recorded before matched positions as matching none", () => {
    const older = [
      { id: "a", ruleName: "Cap", status: "acceptable" },
      { ruleName: "No id", status: "needs_review", matchedPosition: "Standard" },
      "not a finding",
    ];

    const findings = storedPlaybookFindings(older);

    expect(findings).toEqual([
      expect.objectContaining({ id: "a", matchedPosition: "none" }),
      // An id is what a decision is recorded against.
      expect.objectContaining({ id: "finding-2", matchedPosition: "standard" }),
    ]);
    // Without a matched position, nothing from an older run is offered for
    // bulk acceptance.
    expect(bulkAcceptableFindings(storedPlaybookFindings([older[0]]))).toEqual([]);
    expect(storedPlaybookFindings(JSON.stringify(older.slice(0, 1)))).toHaveLength(1);
    expect(storedPlaybookFindings(null)).toEqual([]);
  });
});
