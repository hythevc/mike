// SPDX-License-Identifier: AGPL-3.0-only
//
// The converter: one upstream skill folder plus its per-workflow manifest
// (workflow.yaml + edits.yaml) becomes one Mike catalog entry. It is
// mechanical and deterministic, treats every source byte as untrusted data,
// never copies scripts or tooling, carries licences and notices, appends the
// guardrail texts, and refuses unsafe instructions unless a recorded edit
// removes them. The output passes Mike's own catalog parser.

import { createHash } from "crypto";
import {
  copilotBlock,
  jurisdictionLine,
  outputRequirements,
  tabularCopilotNotice,
} from "./guardrail";
import {
  assertCleanLint,
  assertNoReferenceResidue,
} from "./lint";
import {
  assertLicenseEvidenceConfirmed,
  assertLicenseFileMatches,
  canonicalConverterLicense,
  type ConverterLicense,
  type LicenseEvidence,
  licenseFamily,
} from "./licenses";
import {
  attributionFooter,
  changesFile,
  docxProvenanceParagraph,
  noticeFile,
  provenanceYaml,
  SOURCE_LIST,
} from "./notices";
import { displaySlug, normalizeMarkdown, renderMarkdownToDocx } from "./markdown";
import {
  resolveSourceFile,
  SkillConversionError,
  type SkillSource,
  sourceText,
} from "./sourceReader";

const WORKFLOW_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 60 * 1024;
const MAX_DISPLAY_NAME = 50;
const MAX_KEY_LENGTH = 48;

// The closed practice list (conversionSpec 6); exactly one per workflow.
const PRACTICES = new Set([
  "Commercial Contracts",
  "Data Protection & Privacy",
  "Litigation & Dispute Resolution",
  "Employment",
  "AI Governance",
  "Legal Operations",
  "Regulatory & Compliance",
  "General Practice",
]);

// Jurisdiction code to label (conversionSpec 7). Labels never contain a comma.
const JURISDICTION_LABELS: Record<string, string> = {
  ALL: "General",
  EU: "European Union",
  EEA: "European Economic Area",
  GB: "United Kingdom",
  "GB-EAW": "England and Wales",
  "GB-SCT": "Scotland",
  "GB-NIR": "Northern Ireland",
  US: "United States",
  "US-CA": "California",
  "US-DE": "Delaware",
  DE: "Germany",
  FR: "France",
  IE: "Ireland",
  BE: "Belgium",
  NL: "Netherlands",
  IT: "Italy",
  PL: "Poland",
  AT: "Austria",
  CH: "Switzerland",
  AE: "United Arab Emirates",
};

// ISO 639-1 code to the English language name Mike and upstream use.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  pl: "Polish",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  fi: "Finnish",
};

// Citation shapes that make an ALL (jurisdiction-neutral) workflow suspect.
const ALL_CITATION_PATTERNS = [
  /U\.S\.C\./,
  /C\.F\.R\./,
  /\bCPR\b/,
  /\bERA\b/,
  /\bGDPR\b/,
  /\bArt\.\s*\d/,
  /\bs\.\s*\d/,
  /\sv\.\s/,
  /\bECLI\b/,
  /\bCELEX\b/,
];

// Fenced code blocks whose info string is one of these are script content and
// are removed mechanically, with a recorded note in their place.
const SCRIPT_FENCE_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "powershell",
  "ps1",
  "cmd",
  "bat",
  "python",
  "py",
  "javascript",
  "js",
  "node",
  "typescript",
  "ts",
]);

const SCRIPT_REMOVED_SENTENCE =
  "An automated helper step from the original skill was removed. Do this " +
  "check by reading the documents directly, show your working, and say " +
  "plainly if it could not be done.";

export type AssetMapping = {
  from: string;
  as: "docx" | "xlsx" | "inline";
  title?: string;
  purpose: string;
};

export type TabularColumn = {
  index: number;
  name: string;
  prompt: string;
  format?: string;
  tags?: string[];
};

export type WorkflowManifest = {
  key: string;
  displayName: string;
  sourceSkill: string;
  collection: "assistant" | "tabular";
  pack: string;
  description: string;
  practice: string;
  jurisdictionCodes: string[];
  languageCode: string;
  license: string;
  licenseEvidence: LicenseEvidence;
  authorConfirmation?: string | null;
  authorConfirmationReference?: string | null;
  authorCredit: string;
  authorOrganisation?: string | null;
  authorUrl?: string | null;
  copyrightLines?: string[];
  originalTitle: string;
  upstreamVersion: string;
  version?: string;
  assetPrefix?: string;
  assets?: AssetMapping[];
  webUse?: "none" | "optional";
  reviewBy: string;
  changeSummary: string;
  removed?: string[];
  corrected?: string[];
  reviewedBy?: string | null;
  columns?: TabularColumn[];
  tabularInstructions?: string;
  subjectGuidance?: string;
  /** A reviewer's recorded waiver that every ALL-jurisdiction citation match is a labelled example. */
  allWaiver?: string | null;
};

export type EditEntry = {
  file?: string;
  op: "replace" | "deleteSection" | "insertAfter" | "appendSection";
  find?: string;
  heading?: string;
  anchor?: string;
  with?: string;
  text?: string;
  count?: number;
  reason: string;
  category: "safety" | "accuracy" | "platform" | "licence" | "branding";
};

export type EditsManifest = { edits: EditEntry[] };

export type ConvertContext = {
  company: string;
  catalogRepositoryUrl: string;
  releaseTag: string;
  sourceCommit: string;
  modifiedOn: string;
  docxDate: Date;
};

export type ConversionReport = {
  key: string;
  droppedFiles: Array<{ path: string; sha256: string; reason: string }>;
  rewrittenScriptSpans: Array<{ reason: string; before: string; after: string }>;
  editsApplied: Array<{ file: string; op: string; reason: string; category: string }>;
  references: Array<{ from: string; to: string | null; as: string }>;
};

export type ConversionResult = {
  key: string;
  collection: "assistant-workflows" | "tabular-review-workflows";
  pack: string;
  files: Map<string, Buffer>;
  report: ConversionReport;
};

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Split a SKILL.md into its frontmatter block and body. */
function splitFrontmatter(text: string, skillKey: string): { frontmatter: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new SkillConversionError(skillKey, "SKILL.md", "has no YAML frontmatter");
  }
  return { frontmatter: match[1], body: match[2] };
}

function requireManifestString(
  value: unknown,
  skillKey: string,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SkillConversionError(skillKey, null, `manifest field '${field}' must be a non-empty string`);
  }
  return value.trim();
}

/** The §11 asset filename: '<prefix>-<path-derived>.<ext>'. */
export function assetFilename(
  assetPrefix: string,
  fromPath: string,
  ext: string,
): string {
  const parts = fromPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const leadingGeneric = new Set(["references", "reference", "resources", "assets", "shared"]);
  let withoutExt = parts.join("/").replace(/\.[^.]+$/, "");
  const segments = withoutExt.split("/");
  if (segments.length > 1 && leadingGeneric.has(segments[0].toLowerCase())) {
    const remainder = segments.slice(1).join("/");
    const base = remainder.split("/").pop() ?? remainder;
    if (base.toLowerCase() !== "readme" && base.toLowerCase() !== "index") {
      withoutExt = remainder;
    }
  }
  let derived = withoutExt
    .toLowerCase()
    .replace(/[/_ ]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^-+|-+$/g, "");
  if (!derived || derived.startsWith(".")) derived = `reference`;
  const prefix = assetPrefix.toLowerCase();
  const name = derived.startsWith(`${prefix}-`) || derived === prefix
    ? derived
    : `${prefix}-${derived}`;
  const full = `${name}.${ext}`;
  return full.length > 80 ? `${name.slice(0, 80 - ext.length - 1)}.${ext}` : full;
}

function applyEdits(
  body: string,
  edits: EditEntry[],
  skillKey: string,
  report: ConversionReport,
): string {
  let current = body;
  for (const edit of edits) {
    const count = edit.count ?? 1;
    if (edit.op === "replace") {
      const find = requireEditField(edit.find, skillKey, "find");
      const occurrences = countOccurrences(current, find);
      if (occurrences !== count) {
        throw new SkillConversionError(
          skillKey,
          edit.file ?? "SKILL.md",
          `edit 'replace' expected ${count} match(es) of ${JSON.stringify(trunc(find))} but found ${occurrences}`,
        );
      }
      current = current.split(find).join(edit.with ?? "");
    } else if (edit.op === "deleteSection") {
      const heading = requireEditField(edit.heading, skillKey, "heading");
      current = deleteSection(current, heading, skillKey, edit.file);
    } else if (edit.op === "insertAfter") {
      const anchor = requireEditField(edit.anchor, skillKey, "anchor");
      const occurrences = countOccurrences(current, anchor);
      if (occurrences !== count) {
        throw new SkillConversionError(
          skillKey,
          edit.file ?? "SKILL.md",
          `edit 'insertAfter' expected ${count} match(es) of its anchor but found ${occurrences}`,
        );
      }
      current = current.replace(anchor, `${anchor}${edit.text ?? ""}`);
    } else {
      // appendSection
      current = `${current.trimEnd()}\n\n${edit.text ?? ""}\n`;
    }
    report.editsApplied.push({
      file: edit.file ?? "SKILL.md",
      op: edit.op,
      reason: edit.reason,
      category: edit.category,
    });
  }
  return current;
}

function requireEditField(value: string | undefined, skillKey: string, field: string): string {
  if (!value) {
    throw new SkillConversionError(skillKey, null, `edit is missing its '${field}'`);
  }
  return value;
}

function trunc(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Remove a Markdown section (a heading line and everything up to the next heading of the same or higher level). */
function deleteSection(
  body: string,
  heading: string,
  skillKey: string,
  file?: string,
): string {
  const lines = body.split("\n");
  const headingText = heading.replace(/^#+\s*/, "").trim();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (match && match[2].trim() === headingText) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start === -1) {
    throw new SkillConversionError(
      skillKey,
      file ?? "SKILL.md",
      `edit 'deleteSection' did not find a heading ${JSON.stringify(headingText)}`,
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Remove script fences, recording each in the report, and insert the standard note once. */
function stripScriptFences(body: string, report: ConversionReport): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let noteInserted = false;
  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(/^(```+|~~~+)(.*)$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2].trim().split(/\s+/)[0].toLowerCase();
      if (SCRIPT_FENCE_LANGUAGES.has(lang)) {
        const captured: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith(marker)) {
          captured.push(lines[i]);
          i += 1;
        }
        i += 1; // closing fence
        report.rewrittenScriptSpans.push({
          reason: `removed ${lang} code block`,
          before: captured.join("\n"),
          after: noteInserted ? "" : SCRIPT_REMOVED_SENTENCE,
        });
        if (!noteInserted) {
          out.push(SCRIPT_REMOVED_SENTENCE);
          noteInserted = true;
        }
        continue;
      }
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

/** Delete 'Related skills' and similar cross-skill sections. */
function deletePromotionSections(body: string): string {
  const titles = [
    "Related skills",
    "Integration with other skills",
    "Relationship to other skills",
  ];
  let current = body;
  for (const title of titles) {
    const lines = current.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (match && match[2].trim().toLowerCase() === title.toLowerCase()) {
        const level = match[1].length;
        let end = lines.length;
        for (let j = i + 1; j < lines.length; j += 1) {
          const next = lines[j].match(/^(#{1,6})\s+/);
          if (next && next[1].length <= level) {
            end = j;
            break;
          }
        }
        lines.splice(i, end - i);
        current = lines.join("\n");
        break;
      }
    }
  }
  return current.replace(/\n{3,}/g, "\n\n");
}

/** Rewrite references to a mapped source path in the body. */
function rewriteReference(body: string, fromPath: string, replacement: string): string {
  const variants = [fromPath, `./${fromPath}`];
  let current = body;
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Markdown link: [text](path)
    current = current.replace(
      new RegExp(`\\[([^\\]]*)\\]\\(\\s*${escaped}\\s*\\)`, "g"),
      replacement,
    );
    // Inline code: `path`
    current = current.replace(new RegExp("`" + escaped + "`", "g"), replacement);
    // Bare path with a word boundary.
    current = current.replace(new RegExp(`(^|[\\s(])${escaped}(?=[\\s).,;:]|$)`, "g"), `$1${replacement}`);
  }
  return current;
}

function validateDescription(description: string, skillKey: string): void {
  if (description.length < 60 || description.length > 180) {
    throw new SkillConversionError(
      skillKey,
      null,
      `description is ${description.length} characters; it must be 60-180`,
    );
  }
  if (!description.endsWith("Draft for lawyer review.")) {
    throw new SkillConversionError(
      skillKey,
      null,
      "description must end 'Draft for lawyer review.'",
    );
  }
  if (description.includes("...") || description.includes("…")) {
    throw new SkillConversionError(skillKey, null, "description must not contain an ellipsis");
  }
  if (/^use when\b/i.test(description)) {
    throw new SkillConversionError(skillKey, null, "description must not be a trigger list");
  }
}

function jurisdictionLabels(codes: string[], skillKey: string): string[] {
  if (codes.includes("ALL") && codes.length > 1) {
    throw new SkillConversionError(skillKey, null, "jurisdiction ALL cannot be combined with other codes");
  }
  return codes.map((code) => {
    const label = JURISDICTION_LABELS[code];
    if (!label) {
      throw new SkillConversionError(skillKey, null, `unknown jurisdiction code '${code}'`);
    }
    return label;
  });
}

function buildFrontmatter(
  manifest: WorkflowManifest,
  context: ConvertContext,
  labels: string[],
  attribution: string,
  version: string,
): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${manifest.key}`);
  lines.push(`description: ${yamlQuote(manifest.description)}`);
  lines.push(`license: ${manifest.license}`);
  lines.push("metadata:");
  const metadata: Array<[string, string | null]> = [
    ["version", version],
    ["author", manifest.authorCredit],
    ["author-organisation", manifest.authorOrganisation ?? null],
    ["language", LANGUAGE_NAMES[manifest.languageCode]],
    ["language-code", manifest.languageCode],
    ["mike-display-name", manifest.displayName],
    ["mike-type", manifest.collection],
    ["mike-availability", "add-on"],
    ["practice", manifest.practice],
    ["jurisdictions", labels.join(", ")],
    ["jurisdiction-codes", manifest.jurisdictionCodes.join(", ")],
    ["source-repository", SOURCE_LIST],
    ["source-commit", context.sourceCommit],
    ["source-path", `skills/${manifest.sourceSkill}`],
    ["source-name", manifest.sourceSkill],
    ["source-version", manifest.upstreamVersion],
    ["license-evidence", manifest.licenseEvidence],
    ["author-confirmation", manifest.authorConfirmation ?? "not-required"],
    ["attribution", attribution],
    ["copilot-block", "v1"],
    ["review-by", manifest.reviewBy],
  ];
  for (const [key, value] of metadata) {
    if (value === null) continue;
    lines.push(`  ${key}: ${yamlQuote(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Convert one skill folder plus its manifest into a catalog entry. */
export async function convertWorkflow(
  source: SkillSource,
  manifest: WorkflowManifest,
  edits: EditsManifest,
  context: ConvertContext,
): Promise<ConversionResult> {
  const skillKey = manifest.key;
  // ---- Manifest and identity checks -------------------------------------
  if (!WORKFLOW_KEY_PATTERN.test(skillKey) || skillKey.length > MAX_KEY_LENGTH) {
    throw new SkillConversionError(skillKey, null, "key is invalid or too long");
  }
  if (displaySlug(manifest.displayName) !== skillKey) {
    throw new SkillConversionError(
      skillKey,
      null,
      `display name ${JSON.stringify(manifest.displayName)} does not slug to the key`,
    );
  }
  if (manifest.displayName.length > MAX_DISPLAY_NAME) {
    throw new SkillConversionError(skillKey, null, "display name exceeds 50 characters");
  }
  if (!COMMIT_PATTERN.test(context.sourceCommit)) {
    throw new SkillConversionError(skillKey, null, "source commit must be a 40-character SHA");
  }
  if (!DATE_PATTERN.test(context.modifiedOn) || !DATE_PATTERN.test(manifest.reviewBy)) {
    throw new SkillConversionError(skillKey, null, "dates must be YYYY-MM-DD");
  }
  if (!PRACTICES.has(manifest.practice)) {
    throw new SkillConversionError(skillKey, null, `practice '${manifest.practice}' is not in the closed list`);
  }
  if (!LANGUAGE_NAMES[manifest.languageCode]) {
    throw new SkillConversionError(skillKey, null, `language code '${manifest.languageCode}' is not supported`);
  }
  if (manifest.collection === "tabular" && !/Grid$/.test(manifest.displayName)) {
    throw new SkillConversionError(skillKey, null, "tabular display names must end in 'Grid'");
  }
  validateDescription(manifest.description, skillKey);
  const labels = jurisdictionLabels(manifest.jurisdictionCodes, skillKey);
  const license = canonicalConverterLicense(manifest.license, skillKey);
  const version = manifest.version ?? "1.0.0";

  // ---- Licence files -----------------------------------------------------
  const licenseFileName = findLicenseFile(source);
  assertLicenseEvidenceConfirmed(
    skillKey,
    manifest.licenseEvidence,
    manifest.authorConfirmation ?? null,
    manifest.authorConfirmationReference ?? null,
  );
  if (!licenseFileName) {
    throw new SkillConversionError(
      skillKey,
      null,
      "ships no LICENSE file; the licence text must travel with the workflow",
    );
  }
  const licenseText = sourceText(source, skillKey, licenseFileName);
  assertLicenseFileMatches(skillKey, license, licenseFileName, licenseText);
  const upstreamNotice = findNoticeFile(source);
  const upstreamNoticeText = upstreamNotice
    ? sourceText(source, skillKey, upstreamNotice).trimEnd()
    : null;

  const collectionDir =
    manifest.collection === "assistant" ? "assistant-workflows" : "tabular-review-workflows";
  const packDir = `${manifest.pack}-pack`;
  const workflowDir = `${collectionDir}/${packDir}/${skillKey}`;

  const report: ConversionReport = {
    key: skillKey,
    droppedFiles: [],
    rewrittenScriptSpans: [],
    editsApplied: [],
    references: [],
  };

  recordDroppedFiles(source, manifest, report);

  const files = new Map<string, Buffer>();
  const attributionOneLine = `Adapted from "${manifest.originalTitle}" by ${manifest.authorCredit}; ${license}.`;

  // ---- Body -------------------------------------------------------------
  const skillMd = sourceText(source, skillKey, "SKILL.md");
  const { body: rawBody } = splitFrontmatter(skillMd, skillKey);

  let assembled: string;
  if (manifest.collection === "assistant") {
    assembled = await buildAssistantSkill({
      source,
      manifest,
      edits,
      context,
      labels,
      license,
      attributionOneLine,
      upstreamNoticeText,
      rawBody,
      files,
      workflowDir,
      report,
    });
  } else {
    assembled = buildTabularSkill({
      manifest,
      license,
      attributionOneLine,
      upstreamNoticeText,
      context,
      labels,
      files,
      workflowDir,
    });
  }

  const frontmatter = buildFrontmatter(manifest, context, labels, attributionOneLine, version);
  const skillOutput = `${frontmatter}\n${assembled}\n`;
  if (Buffer.byteLength(skillOutput, "utf8") > MAX_BODY_BYTES) {
    throw new SkillConversionError(
      skillKey,
      "SKILL.md",
      `body is over the 60 KB budget; move appendices to assets`,
    );
  }
  files.set(`${workflowDir}/SKILL.md`, Buffer.from(skillOutput, "utf8"));

  // ---- Licence, notice, changes, provenance -----------------------------
  files.set(`${workflowDir}/LICENSE`, Buffer.from(`${licenseText.trimEnd()}\n`, "utf8"));
  if (licenseFamily(license) === "Apache" && upstreamNoticeText) {
    files.set(
      `${workflowDir}/NOTICE`,
      Buffer.from(
        noticeFile(upstreamNoticeText, context.company, context.modifiedOn, manifest.changeSummary),
        "utf8",
      ),
    );
  }
  files.set(
    `${workflowDir}/CHANGES.md`,
    Buffer.from(
      changesFile({
        version,
        modifiedOn: context.modifiedOn,
        company: context.company,
        sourceCommit: context.sourceCommit,
        sourceFolder: manifest.sourceSkill,
        upstreamVersion: manifest.upstreamVersion,
        removed: manifest.removed ?? [],
        added: [],
        corrected: manifest.corrected ?? [],
        reviewedBy: manifest.reviewedBy ?? null,
      }),
      "utf8",
    ),
  );
  files.set(
    `${workflowDir}/PROVENANCE.yaml`,
    Buffer.from(
      provenanceYaml({
        key: skillKey,
        displayName: manifest.displayName,
        collection: collectionDir,
        pack: manifest.pack,
        sourceRepository: SOURCE_LIST,
        sourceCommit: context.sourceCommit,
        sourcePath: `skills/${manifest.sourceSkill}`,
        sourceName: manifest.sourceSkill,
        sourceVersion: manifest.upstreamVersion,
        licenseDeclared: license,
        licenseInFile: licenseFileName,
        licenseEvidence: manifest.licenseEvidence,
        authorConfirmation: manifest.authorConfirmation ?? "not-required",
        authorConfirmationReference: manifest.authorConfirmationReference ?? null,
        reviewBy: manifest.reviewBy,
        sourceFileHashes: sourceFileHashes(source),
        droppedFiles: report.droppedFiles,
        rewrittenScriptSpans: report.rewrittenScriptSpans,
        editsApplied: report.editsApplied,
        waivers: [],
        reviewers: [],
      }),
      "utf8",
    ),
  );

  return { key: skillKey, collection: collectionDir, pack: manifest.pack, files, report };
}

function findLicenseFile(source: SkillSource): string | null {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.TXT", "COPYING"]) {
    if (source.files.has(name)) return name;
  }
  return null;
}

function findNoticeFile(source: SkillSource): string | null {
  for (const name of ["NOTICE", "NOTICE.md", "NOTICE.txt"]) {
    if (source.files.has(name)) return name;
  }
  return null;
}

function sourceFileHashes(source: SkillSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const relPath of [...source.files.keys()].sort((a, b) => a.localeCompare(b, "en"))) {
    result[relPath] = sha256(source.files.get(relPath)!.bytes);
  }
  return result;
}

function recordDroppedFiles(
  source: SkillSource,
  manifest: WorkflowManifest,
  report: ConversionReport,
): void {
  const kept = new Set<string>(["SKILL.md"]);
  const license = findLicenseFile(source);
  const notice = findNoticeFile(source);
  if (license) kept.add(license);
  if (notice) kept.add(notice);
  for (const asset of manifest.assets ?? []) kept.add(asset.from.replace(/^\.\//, ""));
  for (const relPath of [...source.files.keys()].sort((a, b) => a.localeCompare(b, "en"))) {
    if (kept.has(relPath)) continue;
    report.droppedFiles.push({
      path: relPath,
      sha256: sha256(source.files.get(relPath)!.bytes),
      reason: "not referenced by SKILL.md or mapped by the manifest",
    });
  }
}

type AssistantBuild = {
  source: SkillSource;
  manifest: WorkflowManifest;
  edits: EditsManifest;
  context: ConvertContext;
  labels: string[];
  license: ConverterLicense;
  attributionOneLine: string;
  upstreamNoticeText: string | null;
  rawBody: string;
  files: Map<string, Buffer>;
  workflowDir: string;
  report: ConversionReport;
};

async function buildAssistantSkill(build: AssistantBuild): Promise<string> {
  const { manifest, context, source, report } = build;
  const skillKey = manifest.key;
  // (a) normalise; (d) apply edits; dangerous-char check after edits.
  let body = normalizeMarkdown(build.rawBody);
  // (b) remove the upstream first H1 so our display-name H1 leads.
  body = body.replace(/^#\s+.*\n+/, "");
  body = applyEdits(body, build.edits.edits, skillKey, report);
  assertNoDangerousCharacters(body, skillKey);
  // (e) strip script fences; (i) delete promotion sections.
  body = stripScriptFences(body, report);
  body = deletePromotionSections(body);

  // (g) rewrite references to assets or appendices.
  const shippedAssetPaths: string[] = [];
  const referenceDocLines: string[] = [];
  const appendices: string[] = [];
  for (const asset of manifest.assets ?? []) {
    const fromPath = asset.from.replace(/^\.\//, "");
    const file = resolveSourceFile(source, skillKey, fromPath);
    const refText = decodeAssetMarkdown(file.bytes, skillKey, fromPath);
    if (asset.as === "inline") {
      const title = asset.title ?? titleFromPath(fromPath);
      // Drop the reference's own leading H1: the '## Appendix' heading titles it.
      const inlineContent = normalizeMarkdown(refText).replace(/^#\s+.*\n+/, "").trim();
      appendices.push(`## Appendix: ${title}\n\n${inlineContent}`);
      body = rewriteReference(body, fromPath, `the appendix ${title} below`);
      report.references.push({ from: fromPath, to: null, as: "inline" });
    } else {
      const ext = asset.as;
      const prefix = requireManifestString(manifest.assetPrefix, skillKey, "assetPrefix");
      const filename = assetFilename(prefix, fromPath, ext);
      const assetRef = `assets/${filename}`;
      shippedAssetPaths.push(assetRef);
      const provenance = docxProvenanceParagraph({
        assetPath: `skills/${manifest.sourceSkill}/${fromPath}`,
        originalTitle: manifest.originalTitle,
        authorCredit: manifest.authorCredit,
        license: build.license,
        company: context.company,
        modifiedOn: context.modifiedOn,
        changeSummary: manifest.changeSummary,
      });
      const docx = await renderMarkdownToDocx(refText, {
        title: asset.title ?? titleFromPath(fromPath),
        provenanceParagraph: provenance,
        date: context.docxDate,
      });
      build.files.set(`${build.workflowDir}/${assetRef}`, docx);
      // The edited Markdown of every converted asset stays in source/.
      build.files.set(
        `${build.workflowDir}/source/${filename.replace(/\.[^.]+$/, ".md")}`,
        Buffer.from(`${normalizeMarkdown(refText).trimEnd()}\n`, "utf8"),
      );
      body = rewriteReference(
        body,
        fromPath,
        `\`${assetRef}\` (open it from the workflow's reference documents)`,
      );
      referenceDocLines.push(`- \`${assetRef}\` — ${asset.purpose}`);
      report.references.push({ from: fromPath, to: assetRef, as: ext });
    }
  }

  // The source-derived text that the lint and residue scan see: the body,
  // the reference-documents list and any appendices — never the fixed texts.
  const sourceDerived = [
    body.trim(),
    referenceDocLines.length ? `## Reference documents\n${referenceDocLines.join("\n")}` : "",
    ...appendices,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Lint first: it owns agent-instruction files such as CLAUDE.md, which the
  // residue scan would otherwise flag as an un-rewritten .md reference.
  assertCleanLint(skillKey, sourceDerived);
  assertNoReferenceResidue(skillKey, sourceDerived, shippedAssetPaths);
  assertAllJurisdictionClean(skillKey, manifest.jurisdictionCodes, sourceDerived, manifest.allWaiver);

  // Assemble: H1, copilot block, source-derived text, output requirements, footer.
  const footer = attributionFooter({
    license: build.license,
    originalTitle: manifest.originalTitle,
    authorCredit: manifest.authorCredit,
    copyrightLines: manifest.copyrightLines ?? [],
    sourceCommit: context.sourceCommit,
    sourceFolder: manifest.sourceSkill,
    authorUrl: manifest.authorUrl ?? null,
    noticeText: build.upstreamNoticeText,
    company: context.company,
    modifiedOn: context.modifiedOn,
    changeSummary: manifest.changeSummary,
    catalogRepositoryUrl: context.catalogRepositoryUrl,
    releaseTag: context.releaseTag,
    catalogPath: build.workflowDir,
  });
  return [
    `# ${manifest.displayName}`,
    copilotBlock({
      jurisdictionLine: jurisdictionLine(build.labels),
      webUseNone: manifest.webUse === "none",
    }),
    sourceDerived,
    outputRequirements(),
    footer,
  ].join("\n\n");
}

type TabularBuild = {
  manifest: WorkflowManifest;
  license: ConverterLicense;
  attributionOneLine: string;
  upstreamNoticeText: string | null;
  context: ConvertContext;
  labels: string[];
  files: Map<string, Buffer>;
  workflowDir: string;
};

function buildTabularSkill(build: TabularBuild): string {
  const { manifest, context } = build;
  const skillKey = manifest.key;
  const columns = manifest.columns ?? [];
  if (!columns.length || columns.length > 14) {
    throw new SkillConversionError(skillKey, null, "a tabular workflow needs 1-14 columns");
  }
  columns.forEach((column, index) => {
    if (column.index !== index) {
      throw new SkillConversionError(skillKey, null, "tabular column indexes must run 0..n-1 without gaps");
    }
  });
  if (columns[columns.length - 1].name !== "Points for lawyer review") {
    throw new SkillConversionError(skillKey, null, "the last tabular column must be 'Points for lawyer review'");
  }
  const columnsYaml = [
    "$schema: ../../../workflow-schema/table-columns.schema.yaml",
    "columns:",
    ...columns.flatMap((column) => {
      const lines = [
        `  - index: ${column.index}`,
        `    name: ${yamlQuote(column.name)}`,
        `    prompt: ${yamlQuote(column.prompt)}`,
      ];
      if (column.format) lines.push(`    format: ${yamlQuote(column.format)}`);
      if (column.tags) lines.push(`    tags: [${column.tags.map(yamlQuote).join(", ")}]`);
      return lines;
    }),
    "",
  ].join("\n");
  build.files.set(`${build.workflowDir}/table-columns.yaml`, Buffer.from(columnsYaml, "utf8"));

  const instructions = requireManifestString(
    manifest.tabularInstructions,
    skillKey,
    "tabularInstructions",
  );
  const footer = attributionFooter({
    license: build.license,
    originalTitle: manifest.originalTitle,
    authorCredit: manifest.authorCredit,
    copyrightLines: manifest.copyrightLines ?? [],
    sourceCommit: context.sourceCommit,
    sourceFolder: manifest.sourceSkill,
    authorUrl: manifest.authorUrl ?? null,
    noticeText: build.upstreamNoticeText,
    company: context.company,
    modifiedOn: context.modifiedOn,
    changeSummary: manifest.changeSummary,
    catalogRepositoryUrl: context.catalogRepositoryUrl,
    releaseTag: context.releaseTag,
    catalogPath: build.workflowDir,
  });
  return [
    `# ${manifest.displayName}`,
    manifest.subjectGuidance ??
      `This grid reviews the selected documents and returns one row per document.`,
    instructions.trim(),
    tabularCopilotNotice(),
    footer,
  ].join("\n\n");
}

/**
 * The ALL (jurisdiction-neutral) rule: a workflow labelled ALL must carry no
 * jurisdiction-specific citation, unless a reviewer has recorded a waiver that
 * every match is a labelled example.
 */
function assertAllJurisdictionClean(
  skillKey: string,
  codes: string[],
  text: string,
  waiver: string | null | undefined,
): void {
  if (!codes.includes("ALL") || waiver) return;
  for (const pattern of ALL_CITATION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      throw new SkillConversionError(
        skillKey,
        null,
        `is labelled ALL but cites ${JSON.stringify(match[0])}; narrow the ` +
          "jurisdiction or record a reviewer waiver in the manifest",
      );
    }
  }
}

function assertNoDangerousCharacters(body: string, skillKey: string): void {
  // Imported lazily to avoid a cycle; findDangerousCharacter is pure.
  const match = /[​-‏‪-‮⁠-⁤⁦-⁯﻿]/u.exec(body);
  if (match) {
    throw new SkillConversionError(
      skillKey,
      "SKILL.md",
      "contains a zero-width, bidi or format control character; a recorded edit must remove it",
    );
  }
}

function decodeAssetMarkdown(bytes: Buffer, skillKey: string, fromPath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkillConversionError(skillKey, fromPath, "reference is not valid UTF-8 text");
  }
}

function titleFromPath(fromPath: string): string {
  const base = fromPath.split("/").pop() ?? fromPath;
  return base
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
