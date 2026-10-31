// SPDX-License-Identifier: AGPL-3.0-only
//
// A reviewer's decisions on the findings of a playbook run. Each finding can
// be accepted, overridden with a note, or escalated to a named member of the
// project the reviewed document is in, one finding at a time. Acceptable
// findings that met the rule's standard position can also be accepted
// together; those decisions are recorded as made in bulk. The AI's findings
// are a draft: a decision is the lawyer's, and records who made it and when.
//
// Runs are personal, as the runs lists are: the person who can open a run is
// the one who ran it, while they can still open its playbook. Anyone else
// gets the same 404 as a run that does not exist.
//
// Every change is audited as playbook.decision with ids and decision codes
// only (playbooks.audit.ts).

import type {
  PlaybookDecisionPerson,
  PlaybookFindingDecision,
  PlaybookFindingDecisionKind,
  PlaybookFindingDecisionMethod,
  PlaybookRunDecisions,
} from "@mike/contracts";
import { checkProjectAccess, type ProjectAccess } from "../../lib/access";
import { can } from "../../lib/permissions";
import { listProjectPeople } from "../../lib/projectAccess";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import { storageEnabled } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { recordPlaybookDecisionAudit } from "./playbooks.audit";
import {
  getPlaybook,
  PlaybookRequestError,
  storedPlaybookFindings,
  type Playbook,
  type PlaybookFinding,
} from "./playbooks.operations";

const TABLE = "playbook_finding_decisions";
const DECISION_COLUMNS =
  "run_id, finding_key, decision, method, note, escalated_to, decided_by, decided_at";
// The rules snapshot can be large; only the name it was reviewed under is read.
const RUN_COLUMNS =
  "id, playbook_id, user_id, document_id, document_name, model, review_mode, review_scope, status, findings_json, started_at, completed_at, playbook_name:content_json->>name";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A finding's id: a UUID, or the positional id an older run is read with. */
const FINDING_ID = /^[A-Za-z0-9_-]{1,200}$/;

export const MAX_DECISION_NOTE_LENGTH = 4_000;
/** More than any review has findings (the review schema allows 1,000). */
const MAX_BULK_FINDINGS = 1_000;

export const RUN_NOT_FOUND = "Run not found.";
export const FINDING_NOT_FOUND = "Finding not found.";
export const OVERRIDE_NOTE_REQUIRED =
  "Add a note saying why you are overriding this finding.";
export const NO_PROJECT_FOR_ESCALATION =
  "Escalation goes to a member of the project the reviewed document is in, and this document is not in a project you can open.";
export const BULK_ACCEPT_REFUSED =
  "Only acceptable findings that meet the standard position can be accepted together.";
const RUN_NOT_FINISHED =
  "Decisions can be recorded once the review has finished.";

type DecisionRow = {
  run_id: string;
  finding_key: string;
  decision: PlaybookFindingDecisionKind;
  method: PlaybookFindingDecisionMethod;
  note: string | null;
  escalated_to: string | null;
  decided_by: string | null;
  decided_at: string;
};

export type PlaybookRunRow = {
  id: string;
  playbook_id: string;
  user_id: string;
  document_id: string | null;
  document_name: string | null;
  model: string;
  review_mode: string | null;
  review_scope: string | null;
  status: string;
  findings_json: unknown;
  started_at: string;
  completed_at: string | null;
  /** The playbook's name in the rules snapshot the run reviewed against. */
  playbook_name?: string | null;
};

/** A run the caller can open, with its playbook and its findings. */
export type OpenedPlaybookRun = {
  run: PlaybookRunRow;
  playbook: Playbook;
  findings: PlaybookFinding[];
};

/** The project a run's reviewed document is in, as the caller can open it. */
export type PlaybookRunProject = {
  id: string;
  name: string;
  access: Extract<ProjectAccess, { ok: true }>;
};

/**
 * Findings that "Accept matching findings" accepts: acceptable, met the
 * standard position, and not decided yet. A fallback match is never among
 * them, whatever its status.
 */
export function bulkAcceptableFindings(
  findings: readonly PlaybookFinding[],
  decidedIds: ReadonlySet<string> = new Set(),
): PlaybookFinding[] {
  return findings.filter(
    (finding) =>
      isBulkAcceptable(finding) && !decidedIds.has(finding.id),
  );
}

function isBulkAcceptable(finding: PlaybookFinding): boolean {
  return (
    finding.status === "acceptable" && finding.matchedPosition === "standard"
  );
}

function parseDecisionKind(value: unknown): PlaybookFindingDecisionKind | null {
  return value === "accepted" || value === "overridden" || value === "escalated"
    ? value
    : null;
}

/** The trimmed note, null when blank, or undefined when it is too long. */
function parseNote(value: unknown): string | null | undefined {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note) return null;
  return note.length > MAX_DECISION_NOTE_LENGTH ? undefined : note;
}

/** A person named on a decision: their profile's name and email, if any. */
function decisionPerson(
  userId: string | null,
  profiles: ReadonlyMap<string, { display_name: string | null; email: string | null }>,
): PlaybookDecisionPerson | null {
  if (!userId) return null;
  const profile = profiles.get(userId);
  return {
    userId,
    displayName: profile?.display_name ?? null,
    email: profile?.email ?? null,
  };
}

/** Rows as the API returns them, with the people they name. */
async function publicDecisions(
  db: Db,
  rows: readonly DecisionRow[],
): Promise<PlaybookFindingDecision[]> {
  const profiles = await loadCreatorProfiles(
    db,
    rows.flatMap((row) => [
      { user_id: row.decided_by },
      { user_id: row.escalated_to },
    ]),
  );
  return rows.map((row) => ({
    findingId: row.finding_key,
    decision: row.decision,
    method: row.method === "bulk" ? "bulk" : "single",
    note: row.note,
    escalatedTo: decisionPerson(row.escalated_to, profiles),
    decidedBy: decisionPerson(row.decided_by, profiles),
    decidedAt: row.decided_at,
  }));
}

async function loadDecisionRows(db: Db, runId: string): Promise<DecisionRow[]> {
  const { data, error } = await db
    .from(TABLE)
    .select(DECISION_COLUMNS)
    .eq("run_id", runId)
    .order("decided_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DecisionRow[];
}

/**
 * The caller's run with its playbook and findings, or the 404 a run they
 * cannot open gets: someone else's run, a run of a playbook they can no
 * longer open, and a run that does not exist all read the same.
 */
export async function openPlaybookRun(
  db: Db,
  args: { userId: string; userEmail?: string | null; runId: string },
): Promise<ServiceResult<OpenedPlaybookRun>> {
  if (!UUID.test(args.runId)) return failure("not_found", RUN_NOT_FOUND);
  try {
    const { data, error } = await db
      .from("playbook_runs")
      .select(RUN_COLUMNS)
      .eq("id", args.runId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", RUN_NOT_FOUND);
    const run = data as PlaybookRunRow;
    let playbook: Playbook;
    try {
      playbook = await getPlaybook(
        args.userId,
        run.playbook_id,
        db,
        args.userEmail,
      );
    } catch (error) {
      if (error instanceof PlaybookRequestError && error.status === 404)
        return failure("not_found", RUN_NOT_FOUND);
      throw error;
    }
    return ok({
      run,
      playbook,
      findings: storedPlaybookFindings(run.findings_json),
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * The project the run's reviewed document is in, when the caller can still
 * open it. Null for a review of pasted text, a document outside a project,
 * a deleted document, or a project the caller has lost.
 */
export async function playbookRunProject(
  db: Db,
  run: Pick<PlaybookRunRow, "document_id">,
  userId: string,
  userEmail?: string | null,
): Promise<PlaybookRunProject | null> {
  if (!run.document_id) return null;
  const { data: document, error } = await db
    .from("documents")
    .select("project_id")
    .eq("id", run.document_id)
    .maybeSingle();
  if (error) throw error;
  const projectId = (document as { project_id?: string | null } | null)
    ?.project_id;
  if (!projectId) return null;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return null;
  const { data: project, error: projectError } = await db
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  return {
    id: projectId,
    name: String((project as { name?: unknown } | null)?.name ?? ""),
    access,
  };
}

/**
 * Whether the run's decision record can be saved to the project: the caller
 * may add documents there, and file storage is configured to hold them. The
 * web app names the project on its export button only when this holds, and
 * the export saves there only when asked to and this still holds.
 */
export function canSaveRecordToProject(project: PlaybookRunProject): boolean {
  return storageEnabled && can(project.access.projectRole, "content.edit");
}

/**
 * The people a finding can be escalated to: everyone who can open the
 * project, except the reviewer and anyone denied it. Ordered by name.
 */
async function escalationMembers(
  db: Db,
  project: PlaybookRunProject,
  userId: string,
): Promise<PlaybookDecisionPerson[]> {
  const listed = await listProjectPeople(db, {
    id: project.id,
    user_id: project.access.project.user_id,
    org_id: project.access.project.org_id ?? null,
    visibility: project.access.project.visibility ?? null,
  });
  if (!listed.ok) throw new Error("Failed to load the project's members");
  const people = new Map<string, PlaybookDecisionPerson>();
  for (const person of [listed.owner, ...listed.members]) {
    if (!person?.user_id || person.user_id === userId) continue;
    if (person.role === "deny" || !person.email) continue;
    people.set(person.user_id, {
      userId: person.user_id,
      displayName: person.display_name ?? null,
      email: person.email,
    });
  }
  const label = (person: PlaybookDecisionPerson) =>
    (person.displayName || person.email || "").toLowerCase();
  return [...people.values()].sort((a, b) => label(a).localeCompare(label(b)));
}

async function runDecisions(
  db: Db,
  opened: OpenedPlaybookRun,
  userId: string,
  userEmail?: string | null,
): Promise<PlaybookRunDecisions> {
  const [rows, project] = await Promise.all([
    loadDecisionRows(db, opened.run.id),
    playbookRunProject(db, opened.run, userId, userEmail),
  ]);
  return {
    runId: opened.run.id,
    project: project
      ? {
          id: project.id,
          name: project.name,
          canAddDocuments: canSaveRecordToProject(project),
        }
      : null,
    decisions: await publicDecisions(db, rows),
  };
}

/** A run's decisions, for anyone who can open the run. */
export async function getPlaybookRunDecisions(
  db: Db,
  args: { userId: string; userEmail?: string | null; runId: string },
): Promise<ServiceResult<PlaybookRunDecisions>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  try {
    return ok(await runDecisions(db, opened.data, args.userId, args.userEmail));
  } catch (error) {
    return internalFailure(error);
  }
}

/** Who a finding of this run can be escalated to. */
export async function listPlaybookEscalationMembers(
  db: Db,
  args: { userId: string; userEmail?: string | null; runId: string },
): Promise<ServiceResult<PlaybookDecisionPerson[]>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  try {
    const project = await playbookRunProject(
      db,
      opened.data.run,
      args.userId,
      args.userEmail,
    );
    if (!project) return failure("conflict", NO_PROJECT_FOR_ESCALATION);
    return ok(await escalationMembers(db, project, args.userId));
  } catch (error) {
    return internalFailure(error);
  }
}

/** The finding a decision is about, or why it cannot be decided. */
function decidableFinding(
  opened: OpenedPlaybookRun,
  findingId: string,
): ServiceResult<PlaybookFinding> {
  if (opened.run.status !== "completed")
    return failure("conflict", RUN_NOT_FINISHED);
  const finding = FINDING_ID.test(findingId)
    ? opened.findings.find((candidate) => candidate.id === findingId)
    : undefined;
  return finding ? ok(finding) : failure("not_found", FINDING_NOT_FOUND);
}

/**
 * Records the caller's decision on one finding, or changes the one already
 * recorded. An override needs a note; an escalation names a member of the
 * reviewed document's project.
 */
export async function recordPlaybookFindingDecision(
  db: Db,
  args: {
    userId: string;
    userEmail?: string | null;
    runId: string;
    findingId: string;
    decision: unknown;
    note?: unknown;
    escalatedTo?: unknown;
  },
): Promise<ServiceResult<PlaybookFindingDecision>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  const finding = decidableFinding(opened.data, args.findingId);
  if (!finding.ok) return finding;
  const decision = parseDecisionKind(args.decision);
  if (!decision)
    return failure(
      "validation",
      "Choose whether to accept, override or escalate the finding.",
    );
  const note = parseNote(args.note);
  if (note === undefined)
    return failure(
      "validation",
      `Keep the note under ${MAX_DECISION_NOTE_LENGTH.toLocaleString("en-US")} characters.`,
    );
  if (decision === "overridden" && !note)
    return failure("validation", OVERRIDE_NOTE_REQUIRED);
  try {
    let escalatedTo: string | null = null;
    if (decision === "escalated") {
      const project = await playbookRunProject(
        db,
        opened.data.run,
        args.userId,
        args.userEmail,
      );
      if (!project) return failure("conflict", NO_PROJECT_FOR_ESCALATION);
      const members = await escalationMembers(db, project, args.userId);
      const target =
        typeof args.escalatedTo === "string" ? args.escalatedTo : "";
      if (!members.some((member) => member.userId === target))
        return failure(
          "validation",
          "Choose a member of the document's project to escalate to.",
        );
      escalatedTo = target;
    }
    const { data, error } = await db
      .from(TABLE)
      .upsert(
        {
          run_id: opened.data.run.id,
          finding_key: finding.data.id,
          decision,
          method: "single",
          note,
          escalated_to: escalatedTo,
          decided_by: args.userId,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "run_id,finding_key" },
      )
      .select(DECISION_COLUMNS)
      .single();
    if (error) return internalFailure(error);
    if (!data) return internalFailure(new Error("The decision was not saved"));
    await recordPlaybookDecisionAudit(db, {
      userId: args.userId,
      userEmail: args.userEmail,
      orgId: opened.data.playbook.orgId,
      playbookId: opened.data.run.playbook_id,
      runId: opened.data.run.id,
      documentId: opened.data.run.document_id,
      findingIds: [finding.data.id],
      decision,
      method: "single",
      escalatedTo,
    });
    const [saved] = await publicDecisions(db, [data as DecisionRow]);
    return ok(saved);
  } catch (error) {
    return internalFailure(error);
  }
}

/** Removes the caller's decision on one finding, leaving it undecided. */
export async function clearPlaybookFindingDecision(
  db: Db,
  args: {
    userId: string;
    userEmail?: string | null;
    runId: string;
    findingId: string;
  },
): Promise<ServiceResult<null>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  const finding = decidableFinding(opened.data, args.findingId);
  if (!finding.ok) return finding;
  try {
    const { data, error } = await db
      .from(TABLE)
      .delete()
      .eq("run_id", opened.data.run.id)
      .eq("finding_key", finding.data.id)
      .select("finding_key");
    if (error) return internalFailure(error);
    // Clearing a finding with no decision changes nothing to record.
    if (data?.length)
      await recordPlaybookDecisionAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId: opened.data.playbook.orgId,
        playbookId: opened.data.run.playbook_id,
        runId: opened.data.run.id,
        documentId: opened.data.run.document_id,
        findingIds: [finding.data.id],
        decision: "cleared",
        method: "single",
      });
    return ok(null);
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * Accepts, in one action, the findings the caller confirmed: each must be
 * acceptable and must have met the standard position, so a fallback match is
 * refused rather than accepted. Each is recorded with method "bulk". A
 * finding decided meanwhile keeps its decision. Returns the run's decisions.
 */
export async function bulkAcceptPlaybookFindings(
  db: Db,
  args: {
    userId: string;
    userEmail?: string | null;
    runId: string;
    findingIds: unknown;
  },
): Promise<ServiceResult<PlaybookRunDecisions>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  if (opened.data.run.status !== "completed")
    return failure("conflict", RUN_NOT_FINISHED);
  const requested = Array.isArray(args.findingIds)
    ? [...new Set(args.findingIds)]
    : [];
  if (
    !requested.length ||
    requested.length > MAX_BULK_FINDINGS ||
    requested.some((id) => typeof id !== "string")
  )
    return failure("validation", "Choose the findings to accept.");
  const byId = new Map(
    opened.data.findings.map((finding) => [finding.id, finding]),
  );
  for (const id of requested as string[]) {
    const finding = byId.get(id);
    if (!finding) return failure("not_found", FINDING_NOT_FOUND);
    if (!isBulkAcceptable(finding))
      return failure("validation", BULK_ACCEPT_REFUSED);
  }
  try {
    const decided = new Set(
      (await loadDecisionRows(db, opened.data.run.id)).map(
        (row) => row.finding_key,
      ),
    );
    const toAccept = (requested as string[]).filter((id) => !decided.has(id));
    if (toAccept.length) {
      const decidedAt = new Date().toISOString();
      const { data, error } = await db
        .from(TABLE)
        .upsert(
          toAccept.map((id) => ({
            run_id: opened.data.run.id,
            finding_key: id,
            decision: "accepted",
            method: "bulk",
            note: null,
            escalated_to: null,
            decided_by: args.userId,
            decided_at: decidedAt,
          })),
          // Another tab may decide one of these first; its decision stays.
          { onConflict: "run_id,finding_key", ignoreDuplicates: true },
        )
        .select("finding_key");
      if (error) return internalFailure(error);
      const accepted = ((data ?? []) as { finding_key: string }[]).map(
        (row) => row.finding_key,
      );
      if (accepted.length)
        await recordPlaybookDecisionAudit(db, {
          userId: args.userId,
          userEmail: args.userEmail,
          orgId: opened.data.playbook.orgId,
          playbookId: opened.data.run.playbook_id,
          runId: opened.data.run.id,
          documentId: opened.data.run.document_id,
          findingIds: accepted,
          decision: "accepted",
          method: "bulk",
        });
    }
    return ok(await runDecisions(db, opened.data, args.userId, args.userEmail));
  } catch (error) {
    return internalFailure(error);
  }
}

/** The decisions on an opened run, with the people they name, for exports. */
export async function openedRunDecisions(
  db: Db,
  runId: string,
): Promise<PlaybookFindingDecision[]> {
  return publicDecisions(db, await loadDecisionRows(db, runId));
}
