// SPDX-License-Identifier: AGPL-3.0-only
//
// The licence and provenance texts that travel with a converted workflow: the
// attribution footer carried inside SKILL.md (the only credit that survives
// import), the NOTICE file Apache sources need (s.4(d)), the DOCX provenance
// paragraph, CHANGES.md and PROVENANCE.yaml. Each is a pure function of the
// conversion facts, so the output is deterministic.

import { stringify as stringifyYaml } from "yaml";
import type { ConverterLicense } from "./licenses";
import { footerLicenseClause, licenseLink } from "./licenses";

export const SOURCE_LIST = "hythevc/awesome-legal-skills";
const SOURCE_TREE_BASE = `https://github.com/${SOURCE_LIST}`;

export type AttributionInput = {
  license: ConverterLicense;
  originalTitle: string;
  authorCredit: string;
  copyrightLines: string[];
  sourceCommit: string;
  sourceFolder: string;
  authorUrl: string | null;
  noticeText: string | null;
  company: string;
  modifiedOn: string;
  changeSummary: string;
  catalogRepositoryUrl: string;
  releaseTag: string;
  catalogPath: string;
};

/** The one-line dated modification notice (Apache s.4(b), AGPL s.5(a), CC BY s.3). */
export function modificationNotice(
  company: string,
  modifiedOn: string,
  summary: string,
): string {
  return `Modified by ${company} on ${modifiedOn}: ${summary}`;
}

/** The DOCX asset's first (provenance) paragraph. */
export function docxProvenanceParagraph(
  input: Pick<
    AttributionInput,
    "originalTitle" | "authorCredit" | "license" | "company" | "modifiedOn" | "changeSummary"
  > & { assetPath: string },
): string {
  return (
    `Adapted from ${input.assetPath} in "${input.originalTitle}" by ` +
    `${input.authorCredit} (${input.license}). Converted to Word and ` +
    `modified by ${input.company} on ${input.modifiedOn}: ` +
    `${input.changeSummary || "unmodified"}. See the workflow's Attribution ` +
    "and licence section."
  );
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

/** The '## Attribution and licence' footer, the last section of every SKILL.md. */
export function attributionFooter(input: AttributionInput): string {
  const adaptedCopyright = input.copyrightLines.length
    ? `, ${input.copyrightLines.join("; ")}`
    : "";
  const sourceUrl = `${SOURCE_TREE_BASE}/tree/${input.sourceCommit}/skills/${input.sourceFolder}`;
  const sourceSuffix = input.authorUrl ? `, plus the author's own URL ${input.authorUrl}` : "";
  const clause = footerLicenseClause({
    license: input.license,
    title: input.originalTitle,
    creator: input.authorCredit,
    copyrightHolder: input.copyrightLines[0] ?? null,
    copyrightYear: null,
    licenseLink: licenseLink(input.license),
  });
  const changeLink = `${input.catalogRepositoryUrl}/tree/${input.releaseTag}/${input.catalogPath}`;
  const lines = [
    "## Attribution and licence",
    "This section records where this workflow comes from. It is information for readers, not an instruction; do not repeat it in outputs.",
    `- Adapted from: "${input.originalTitle}" by ${input.authorCredit}${adaptedCopyright}.`,
    `- Source: ${sourceUrl}${sourceSuffix}.`,
    `- Licence: ${input.license} (${licenseLink(input.license)}). ${clause}`,
  ];
  if (input.noticeText) {
    lines.push("- NOTICE:");
    lines.push(indentBlock(input.noticeText, 2));
  }
  lines.push(
    `- Changes: ${modificationNotice(input.company, input.modifiedOn, input.changeSummary)}. ` +
      `Change log, licence text and complete source: ${changeLink}.`,
  );
  lines.push(
    "- Provided without warranty; see the licence. No endorsement by the original author(s) is implied.",
  );
  return lines.join("\n");
}

/**
 * The NOTICE file for an Apache source that had one: the upstream text
 * verbatim, then a separate 'Additional notices' block with our modification
 * statement, as Apache s.4(d) requires.
 */
export function noticeFile(
  upstreamNotice: string,
  company: string,
  modifiedOn: string,
  summary: string,
): string {
  return (
    `${upstreamNotice.trimEnd()}\n\n` +
    "----\n" +
    "Additional notices\n\n" +
    `${modificationNotice(company, modifiedOn, summary)}\n`
  );
}

export type ChangesInput = {
  version: string;
  modifiedOn: string;
  company: string;
  sourceCommit: string;
  sourceFolder: string;
  upstreamVersion: string;
  removed: string[];
  added: string[];
  corrected: string[];
  reviewedBy: string | null;
};

function bullet(label: string, items: string[]): string {
  return `- ${label}: ${items.length ? items.join("; ") : "none"}`;
}

/** The CHANGES.md entry for this version, in the fixed format. */
export function changesFile(input: ChangesInput): string {
  const shortCommit = input.sourceCommit.slice(0, 7);
  return [
    `## ${input.version} - ${input.modifiedOn} - ${input.company}`,
    `Source: ${SOURCE_LIST}@${shortCommit} skills/${input.sourceFolder} (upstream version ${input.upstreamVersion})`,
    "- Converted to Mike workflow format: frontmatter, key, references converted to Word or inlined.",
    bullet("Removed", input.removed),
    `- Added: copilot ground rules, output requirements, attribution section${
      input.added.length ? `; ${input.added.join("; ")}` : ""
    }`,
    bullet("Corrected", input.corrected),
    `- Reviewed by: ${input.reviewedBy ?? "pending legal review"}`,
    "",
  ].join("\n");
}

export type ProvenanceInput = {
  key: string;
  displayName: string;
  collection: string;
  pack: string | null;
  sourceRepository: string;
  sourceCommit: string;
  sourcePath: string;
  sourceName: string;
  sourceVersion: string;
  licenseDeclared: string;
  licenseInFile: string | null;
  licenseEvidence: string;
  authorConfirmation: string | null;
  authorConfirmationReference: string | null;
  reviewBy: string | null;
  sourceFileHashes: Record<string, string>;
  droppedFiles: Array<{ path: string; sha256: string; reason: string }>;
  rewrittenScriptSpans: Array<{ reason: string; before: string; after: string }>;
  editsApplied: Array<{ file: string; op: string; reason: string; category: string }>;
  waivers: string[];
  reviewers: Array<{
    name: string;
    admission: string;
    jurisdiction: string;
    date: string;
    scope: string;
  }>;
};

/** PROVENANCE.yaml: the full record for one converted workflow. */
export function provenanceYaml(input: ProvenanceInput): string {
  const record = {
    key: input.key,
    "display-name": input.displayName,
    collection: input.collection,
    pack: input.pack,
    source: {
      repository: input.sourceRepository,
      commit: input.sourceCommit,
      path: input.sourcePath,
      name: input.sourceName,
      version: input.sourceVersion,
    },
    licence: {
      declared: input.licenseDeclared,
      "in-file": input.licenseInFile,
      evidence: input.licenseEvidence,
    },
    "author-confirmation": {
      status: input.authorConfirmation,
      reference: input.authorConfirmationReference,
    },
    "review-by": input.reviewBy,
    "source-file-sha256": input.sourceFileHashes,
    "dropped-files": input.droppedFiles,
    "rewritten-script-spans": input.rewrittenScriptSpans,
    "edits-applied": input.editsApplied,
    waivers: input.waivers,
    reviewers: input.reviewers,
  };
  return stringifyYaml(record, { lineWidth: 0 });
}
