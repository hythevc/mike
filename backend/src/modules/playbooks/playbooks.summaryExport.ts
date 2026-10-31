// SPDX-License-Identifier: AGPL-3.0-only
//
// The decision record of a playbook run: a Word document a supervisor can
// read without opening the review. It names what was reviewed and how, then
// lists every finding (its rule, status, quote, location and suggested
// language) beside the reviewer's decision, how it was made, by whom and
// when. Findings accepted together are listed in their own section with
// their count. The record says it is an AI-generated draft whose decisions a
// named reviewer recorded, and that it is legal information, not legal
// advice.
//
// When the reviewed document is in a project the caller can add documents
// to, the record is saved there through the documents facade; otherwise the
// route sends it to the browser as a download.

import crypto from "node:crypto";
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type {
  PlaybookDecisionPerson,
  PlaybookDecisionRecordSaved,
  PlaybookFindingDecision,
} from "@mike/contracts";
import { contentTypeForDocumentType } from "../../lib/documentTypes";
import { contentSha256 } from "../../lib/documentVersions";
import { can } from "../../lib/permissions";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  deleteFile,
  generatedDocKey,
  storageEnabled,
  uploadFile,
} from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import { createDocumentVersion } from "../documents/documents.service";
import {
  openedRunDecisions,
  openPlaybookRun,
  playbookRunProject,
  type PlaybookRunProject,
} from "./playbooks.decisions";
import type { PlaybookFinding } from "./playbooks.operations";

export const DECISION_RECORD_TITLE = "Playbook decision record";
export const DECISION_RECORD_DISCLAIMER =
  "Legal information, not legal advice. Check each finding against the reviewed document before relying on it.";
export const BULK_SECTION_INTRO =
  "These findings were acceptable, met the standard position, and were accepted together.";

const STATUS_LABELS: Record<PlaybookFinding["status"], string> = {
  unacceptable: "Unacceptable",
  missing_required: "Missing",
  needs_review: "Needs review",
  acceptable: "Acceptable",
  not_applicable: "Not applicable",
  outside_scope: "Outside scope",
};
const MATCHED_POSITION_LABELS: Record<PlaybookFinding["matchedPosition"], string> = {
  standard: "Standard",
  fallback: "Fallback",
  none: "None",
};
const DECISION_LABELS: Record<PlaybookFindingDecision["decision"], string> = {
  accepted: "Accepted",
  overridden: "Overridden",
  escalated: "Escalated",
};
const METHOD_LABELS: Record<PlaybookFindingDecision["method"], string> = {
  single: "Individually",
  bulk: "In bulk",
};
const NOT_DECIDED = "Not decided";
const NOT_RECORDED = "Not recorded";
const DELETED_ACCOUNT = "Deleted account";

export type DecisionRecordInput = {
  documentName: string | null;
  playbookName: string;
  model: string;
  reviewScope: "full" | "issues";
  reviewMode: "strict" | "permissive";
  startedAt: string;
  exportedAt: string;
  findings: readonly PlaybookFinding[];
  decisions: readonly PlaybookFindingDecision[];
};

export type PlaybookDecisionRecordExport =
  | { kind: "saved"; saved: PlaybookDecisionRecordSaved }
  | { kind: "download"; filename: string; bytes: Buffer };

/** "31 Oct 2026, 10:02 UTC": one zone for every reader of the record. */
export function formatRecordTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_RECORDED;
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function personLabel(person: PlaybookDecisionPerson | null): string {
  if (!person) return DELETED_ACCOUNT;
  return person.displayName?.trim() || person.email?.trim() || DELETED_ACCOUNT;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * "AI-generated draft. Decisions recorded by <reviewer>." naming everyone
 * who recorded a decision on the run, in the order they first did.
 */
export function decisionRecordDraftLabel(
  decisions: readonly PlaybookFindingDecision[],
): string {
  const reviewers = [
    ...new Set(
      [...decisions]
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
        .map((decision) =>
          decision.decidedBy
            ? personLabel(decision.decidedBy)
            : "a deleted account",
        ),
    ),
  ];
  return reviewers.length
    ? `AI-generated draft. Decisions recorded by ${joinNames(reviewers)}.`
    : "AI-generated draft. No decisions have been recorded yet.";
}

/** "<document> - decision record.docx", safe for every file system. */
export function decisionRecordFilename(documentName: string | null): string {
  const stem = (documentName ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${stem || "Playbook review"} - decision record.docx`;
}

/** Characters XML 1.0 cannot carry would make the file unreadable. */
function xmlSafe(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

function textParagraphs(text: string, options: { italics?: boolean } = {}) {
  return xmlSafe(text)
    .split(/\r?\n/)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, italics: options.italics })],
        }),
    );
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
const CELL_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
};

/** A two-column table of labelled values. */
function fieldTable(rows: readonly (readonly [string, string])[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 28, type: WidthType.PERCENTAGE },
              borders: CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: label, bold: true })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 72, type: WidthType.PERCENTAGE },
              borders: CELL_BORDERS,
              children: textParagraphs(value || NOT_RECORDED),
            }),
          ],
        }),
    ),
  });
}

function findingRows(
  finding: PlaybookFinding,
  decision: PlaybookFindingDecision | undefined,
): [string, string][] {
  const rows: [string, string][] = [
    ["Status", STATUS_LABELS[finding.status] ?? finding.status],
    ["Matched position", MATCHED_POSITION_LABELS[finding.matchedPosition]],
    ["Location", finding.location || NOT_RECORDED],
    ["Quote", finding.quote || "No quote"],
    ["Suggested language", finding.suggestedText || "None"],
    ["Decision", decision ? DECISION_LABELS[decision.decision] : NOT_DECIDED],
    ["Method", decision ? METHOD_LABELS[decision.method] : NOT_RECORDED],
    ["Reviewer", decision ? personLabel(decision.decidedBy) : NOT_RECORDED],
    ["Time", decision ? formatRecordTime(decision.decidedAt) : NOT_RECORDED],
  ];
  if (decision?.decision === "escalated")
    rows.push(["Escalated to", personLabel(decision.escalatedTo)]);
  if (decision?.note) rows.push(["Note", decision.note]);
  return rows;
}

function findingBlock(
  finding: PlaybookFinding,
  decision: PlaybookFindingDecision | undefined,
) {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun(xmlSafe(finding.ruleName))],
    }),
    fieldTable(findingRows(finding, decision)),
    new Paragraph({ children: [] }),
  ];
}

/** The record as a Word document. Pure: the caller loads what it shows. */
export async function buildPlaybookDecisionRecord(
  record: DecisionRecordInput,
): Promise<Buffer> {
  const decisionByFinding = new Map(
    record.decisions.map((decision) => [decision.findingId, decision]),
  );
  const decidedCount = record.findings.filter((finding) =>
    decisionByFinding.has(finding.id),
  ).length;
  const bulk = record.findings.filter(
    (finding) => decisionByFinding.get(finding.id)?.method === "bulk",
  );
  const others = record.findings.filter(
    (finding) => decisionByFinding.get(finding.id)?.method !== "bulk",
  );
  const total = record.findings.length;
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(DECISION_RECORD_TITLE)],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: xmlSafe(decisionRecordDraftLabel(record.decisions)),
          bold: true,
        }),
      ],
    }),
    ...textParagraphs(DECISION_RECORD_DISCLAIMER, { italics: true }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Review")] }),
    fieldTable([
      ["Document", record.documentName || "Untitled document"],
      ["Playbook", record.playbookName || "Untitled playbook"],
      ["Model", record.model],
      ["Scope", record.reviewScope === "issues" ? "Issues only" : "Full review"],
      ["Posture", record.reviewMode === "permissive" ? "Permissive" : "Strict"],
      ["Reviewed", formatRecordTime(record.startedAt)],
      ["Exported", formatRecordTime(record.exportedAt)],
      [
        "Decided",
        `${decidedCount} of ${total} ${total === 1 ? "finding" : "findings"}`,
      ],
    ]),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(`Findings (${others.length})`)],
    }),
    ...(others.length
      ? others.flatMap((finding) =>
          findingBlock(finding, decisionByFinding.get(finding.id)),
        )
      : [new Paragraph({ children: [new TextRun("None.")] })]),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun(
          `Accepted in bulk (${bulk.length} ${bulk.length === 1 ? "finding" : "findings"})`,
        ),
      ],
    }),
    ...(bulk.length
      ? [
          new Paragraph({ children: [new TextRun(BULK_SECTION_INTRO)] }),
          ...bulk.flatMap((finding) =>
            findingBlock(finding, decisionByFinding.get(finding.id)),
          ),
        ]
      : [
          new Paragraph({
            children: [new TextRun("No findings were accepted in bulk.")],
          }),
        ]),
  ];
  const document = new Document({
    title: DECISION_RECORD_TITLE,
    description: decisionRecordDraftLabel(record.decisions),
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

/**
 * Saves the record as a new document in the project, through the documents
 * facade. The caller has checked it may add documents there.
 */
async function saveDecisionRecord(
  db: Db,
  args: {
    userId: string;
    project: PlaybookRunProject;
    filename: string;
    bytes: Buffer;
  },
): Promise<PlaybookDecisionRecordSaved> {
  const documentId = crypto.randomUUID();
  const storagePath = generatedDocKey(args.userId, documentId, args.filename);
  await uploadFile(
    storagePath,
    args.bytes.buffer.slice(
      args.bytes.byteOffset,
      args.bytes.byteOffset + args.bytes.byteLength,
    ) as ArrayBuffer,
    contentTypeForDocumentType("docx"),
  );
  try {
    // The project's organization is stamped by the database.
    const inserted = await db.from("documents").insert({
      id: documentId,
      project_id: args.project.id,
      user_id: args.userId,
      status: "ready",
    });
    if (inserted.error) throw inserted.error;
    const { data: version, error } = await createDocumentVersion(db, {
      document_id: documentId,
      storage_path: storagePath,
      pdf_storage_path: null,
      source: "generated",
      version_number: 1,
      filename: args.filename,
      file_type: "docx",
      size_bytes: args.bytes.byteLength,
      content_sha256: contentSha256(args.bytes),
    });
    if (error || !version) {
      await db.from("documents").delete().eq("id", documentId);
      throw error ?? new Error("The decision record's version was not created");
    }
  } catch (error) {
    // No version refers to the uploaded file, so nothing else would remove
    // it. A failed removal leaves an orphaned object, not a broken record,
    // and the original failure is the one to report.
    await deleteFile(storagePath).catch(() => undefined);
    throw error;
  }
  return {
    documentId,
    projectId: args.project.id,
    projectName: args.project.name,
    filename: args.filename,
  };
}

/**
 * Builds a run's decision record and saves it to the reviewed document's
 * project when the caller can add documents there, or hands it back for
 * download.
 */
export async function exportPlaybookDecisionRecord(
  db: Db,
  args: {
    userId: string;
    userEmail?: string | null;
    runId: string;
    /** When the record was made; now by default. */
    now?: Date;
  },
): Promise<ServiceResult<PlaybookDecisionRecordExport>> {
  const opened = await openPlaybookRun(db, args);
  if (!opened.ok) return opened;
  const { run, playbook, findings } = opened.data;
  if (run.status !== "completed")
    return failure(
      "conflict",
      "Export the decision record once the review has finished.",
    );
  try {
    const [decisions, project] = await Promise.all([
      openedRunDecisions(db, run.id),
      playbookRunProject(db, run, args.userId, args.userEmail),
    ]);
    const filename = decisionRecordFilename(run.document_name);
    const bytes = await buildPlaybookDecisionRecord({
      documentName: run.document_name,
      // The name the run was reviewed under, as its rules snapshot holds it.
      playbookName: run.playbook_name || playbook.name,
      model: run.model,
      reviewScope: run.review_scope === "issues" ? "issues" : "full",
      reviewMode: run.review_mode === "permissive" ? "permissive" : "strict",
      startedAt: run.started_at,
      exportedAt: (args.now ?? new Date()).toISOString(),
      findings,
      decisions,
    });
    if (
      project &&
      storageEnabled &&
      can(project.access.projectRole, "content.edit")
    ) {
      return ok({
        kind: "saved",
        saved: await saveDecisionRecord(db, {
          userId: args.userId,
          project,
          filename,
          bytes,
        }),
      });
    }
    return ok({ kind: "download", filename, bytes });
  } catch (error) {
    return internalFailure(error);
  }
}
