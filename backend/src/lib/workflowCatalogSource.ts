import { createHash } from "crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import JSZip, { type JSZipObject } from "jszip";
import { parse as parseYaml } from "yaml";
import { WORKFLOW_CATALOG_PIN } from "./workflowCatalogPin";

const DEFAULT_REPOSITORY = WORKFLOW_CATALOG_PIN.repository;
// The pinned commit is only a default for the pinned repository: any other
// repository must name its own ref.
const DEFAULT_REF = WORKFLOW_CATALOG_PIN.commit;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_NOTICE_BYTES = 256 * 1024;
const MAX_ATTRIBUTION_LENGTH = 2_000;
const MAX_WORKFLOWS = 1_000;
const MAX_ASSETS_PER_WORKFLOW = 50;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const COLLECTION_PREFIXES = [
  "assistant-workflows/",
  "tabular-review-workflows/",
] as const;

// Licences a catalog workflow may ship under, keyed by the lower-cased SPDX
// identifier the catalog declares. "AGPL-3.0" is the deprecated identifier for
// AGPL-3.0-only and is stored under that name.
export const WORKFLOW_LICENSES = [
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "CC-BY-4.0",
  "MIT",
] as const;
export type WorkflowLicense = (typeof WORKFLOW_LICENSES)[number];
const LICENSE_BY_DECLARED_ID = new Map<string, WorkflowLicense>([
  ["agpl-3.0", "AGPL-3.0-only"],
  ["agpl-3.0-only", "AGPL-3.0-only"],
  ["agpl-3.0-or-later", "AGPL-3.0-or-later"],
  ["apache-2.0", "Apache-2.0"],
  ["cc-by-4.0", "CC-BY-4.0"],
  ["mit", "MIT"],
]);

/**
 * How the catalog knows a workflow's licence: a licence file shipped with
 * it, or only the author's declaration in a skill manifest.
 */
export type WorkflowLicenseEvidence = "file" | "manifest-only";

const LICENSE_FILENAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];
const NOTICE_FILENAMES = ["NOTICE", "NOTICE.md", "NOTICE.txt"];
const CHANGES_FILENAME = "CHANGES.md";
const CONFIRMED_PATTERN = /^confirmed (\d{4}-\d{2}-\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Nothing executable ships with a workflow. Every file under a collection is
// checked, including files the parser never reads: the sync refuses these
// folders, these file types (scripts and source code, executables, markup
// that can carry script, and Office formats that can carry macros), build and
// package files, symlinks, files with an executable bit, and names that end
// in a dot or a space, which Windows drops ("run.py." arrives as "run.py").
// The folders, file types and build files include the catalog converter's
// own never-ship list.
const NEVER_SHIP_FOLDERS = new Set([
  ".claude-plugin",
  ".github",
  "agents",
  "bin",
  "commands",
  "demo",
  "evals",
  "hooks",
  "node_modules",
  "scripts",
  "tests",
  "tools",
]);
const NEVER_SHIP_EXTENSIONS = new Set([
  // Scripts and source code.
  "applescript",
  "bash",
  "bat",
  "cjs",
  "class",
  "cmd",
  "command",
  "go",
  "ipynb",
  "jar",
  "java",
  "js",
  "jse",
  "jsx",
  "lua",
  "mjs",
  "php",
  "pl",
  "ps1",
  "psm1",
  "py",
  "pyc",
  "rb",
  "rs",
  "scpt",
  "sh",
  "ts",
  "tsx",
  "vbe",
  "vbs",
  "wsf",
  "zsh",
  // Executables, libraries and installers.
  "app",
  "bin",
  "com",
  "cpl",
  "dll",
  "dmg",
  "dylib",
  "exe",
  "lnk",
  "msi",
  "pkg",
  "reg",
  "scr",
  "so",
  "wasm",
  // Markup that can carry script.
  "hta",
  "htm",
  "html",
  "svg",
  "xhtml",
  "xml",
  // Office formats that can carry macros.
  "docm",
  "dotm",
  "potm",
  "ppam",
  "ppsm",
  "pptm",
  "sldm",
  "xla",
  "xlam",
  "xlsb",
  "xlsm",
  "xltm",
]);
// Build and package files, compared in lower case.
const NEVER_SHIP_FILENAMES = new Set([
  "cargo.lock",
  "cargo.toml",
  "dockerfile",
  "gemfile",
  "gemfile.lock",
  "go.mod",
  "go.sum",
  "makefile",
  "package-lock.json",
  "package.json",
  "pipfile",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pyproject.toml",
  "yarn.lock",
]);
const REQUIREMENTS_FILENAME = /^requirements[^/]*\.txt$/;
const FILE_TYPE_MASK = 0o170000;
const SYMLINK_TYPE = 0o120000;
const EXECUTABLE_BITS = 0o111;

// A workflow's assets/ documents are the only catalog files that reach users
// as files. Each must be one of these types, all of which the product reads
// (ALLOWED_DOCUMENT_TYPES in documentTypes.ts), and must begin as that type
// does. The legacy binary Office formats (.doc, .xls, .ppt) are not accepted:
// they can carry macros that no file or part name reveals.
export const WORKFLOW_ASSET_TYPES = ["pdf", "docx", "xlsx", "pptx"] as const;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ASSET_SIGNATURES = new Map<string, Buffer>([
  ["pdf", Buffer.from("%PDF-", "latin1")],
  ["docx", ZIP_SIGNATURE],
  ["xlsx", ZIP_SIGNATURE],
  ["pptx", ZIP_SIGNATURE],
]);
const OFFICE_OPEN_XML_TYPES = new Set(["docx", "xlsx", "pptx"]);
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
// The first bytes of scripts and executables, whatever their names.
const EXECUTABLE_SIGNATURES = [
  Buffer.from("#!", "latin1"), // script
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from("MZ", "latin1"), // Windows executable
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]), // Mach-O
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // Mach-O universal, Java class
  Buffer.from([0x00, 0x61, 0x73, 0x6d]), // WebAssembly
];
// Characters a file name loses or changes on the way to a user's disk:
// control characters and those Windows reserves.
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"|?*\\/]/;

const DEFAULT_QUICK_ACTION_PROMPT =
  "Execute this workflow on the selected documents.";
const DEFAULT_WORD_QUICK_ACTION_PROMPT =
  "Execute this workflow on this Word document.";
const DEFAULT_WORKFLOWS = [
  { key: "proofread", quickAction: true, wordQuickAction: true },
  { key: "compare-documents", quickAction: true, wordQuickAction: false },
  { key: "extract-key-terms", quickAction: true, wordQuickAction: true },
  { key: "draft-from-template", quickAction: true, wordQuickAction: true },
  {
    key: "commercial-agreement-tabular-review",
    quickAction: false,
    wordQuickAction: false,
  },
] as const;
const DEFAULT_WORKFLOW_BY_KEY = new Map<
  string,
  {
    key: string;
    quickAction: boolean;
    wordQuickAction: boolean;
    sortOrder: number;
  }
>(
  DEFAULT_WORKFLOWS.map((workflow, sortOrder) => [
    workflow.key,
    { ...workflow, sortOrder },
  ]),
);

type UnknownRecord = Record<string, unknown>;

export type WorkflowCatalogAssetSource = {
  filename: string;
  file_type: string;
  size_bytes: number;
  content_hash: string;
  temporary_path: string;
};

/**
 * Where a catalog workflow lives and where the catalog adapted it from. The
 * source fields are null for workflows whose metadata does not name a source
 * (the catalog's own workflows).
 */
export type WorkflowCatalogProvenance = {
  /** The catalog repository (owner/name) the workflow was synced from. */
  catalog_repository: string;
  /** The workflow's folder inside that repository. */
  catalog_path: string;
  /** The licence text that governs the workflow, as a repository path. */
  license_file: string;
  source_repository: string | null;
  source_path: string | null;
  source_commit: string | null;
  source_name: string | null;
  source_version: string | null;
  /** The date by which a lawyer should review the workflow again. */
  review_by: string | null;
};

export type WorkflowCatalogSourceWorkflow = {
  workflow_key: string;
  distribution: "default" | "addon";
  version: string | null;
  title: string;
  description: string | null;
  type: "assistant" | "tabular";
  prompt_md: string;
  columns_config: unknown[] | null;
  contributors: Array<{
    name: string;
    organisation: string | null;
    role: string | null;
    linkedin: string | null;
  }>;
  language: string | null;
  practice: string | null;
  jurisdictions: string[] | null;
  pack_key: string | null;
  pack_title: string | null;
  pack_description: string | null;
  pack_version: string | null;
  default_sort_order: number | null;
  quick_action_name: string | null;
  quick_action_prompt: string | null;
  document_upload: boolean;
  word_quick_action: boolean;
  word_quick_action_prompt: string | null;
  license: WorkflowLicense;
  license_evidence: WorkflowLicenseEvidence;
  author_confirmation: string | null;
  attribution: string | null;
  provenance: WorkflowCatalogProvenance;
  notice_md: string | null;
  changes_md: string | null;
  assets: WorkflowCatalogAssetSource[];
  content_hash: string;
};

export type WorkflowCatalogSourceDocument = {
  source_repository: string;
  source_ref: string;
  source_commit: string;
  workflows: WorkflowCatalogSourceWorkflow[];
};

export type PreparedWorkflowCatalog = {
  directory: string;
  catalogPath: string;
  archivePath: string;
  sourceCommit: string;
};

export type WorkflowCatalogSourceOptions = {
  repository?: string;
  ref?: string;
  githubToken?: string;
  fetchImpl?: typeof fetch;
  temporaryRoot?: string;
  /**
   * Refuse workflows whose licence is declared only in a manifest until the
   * author has confirmed it, and any workflow whose author confirmation is
   * pending. Defaults to MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES, which is
   * on unless set to false.
   */
  requireConfirmedLicenses?: boolean;
};

type ParsedPack = {
  key: string;
  title: string;
  description: string;
  version: string;
  workflowNames: string[];
};

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value.trim() || null;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

/** A quoted, bounded form of an untrusted value for an error message. */
function quoted(value: string): string {
  return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateColumnsConfig(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  value.forEach((item, index) => {
    const column = asRecord(item, `${label}[${index}]`);
    if (!Number.isInteger(column.index)) {
      throw new Error(`${label}[${index}].index must be an integer`);
    }
    requiredString(column.name, `${label}[${index}].name`);
    requiredString(column.prompt, `${label}[${index}].prompt`);
    optionalString(column.format, `${label}[${index}].format`);
    if (column.tags !== undefined && column.tags !== null) {
      stringArray(column.tags, `${label}[${index}].tags`);
    }
  });
  return value;
}

function parseYamlObject(source: string, label: string): UnknownRecord {
  try {
    return asRecord(parseYaml(source), label);
  } catch (error) {
    throw new Error(
      `${label} is invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSkill(source: string, label: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${label} must contain YAML frontmatter`);
  return {
    frontmatter: parseYamlObject(match[1], `${label} frontmatter`),
    body: match[2].trimEnd(),
  };
}

/** Text files that travel with a workflow, as stored: LF, no BOM. */
function normalizedText(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
}

/**
 * The licence a workflow declares, in its canonical SPDX form. Anything
 * outside the accepted list fails the sync and names the workflow.
 */
export function canonicalWorkflowLicense(
  declared: unknown,
  workflowKey: string,
): WorkflowLicense {
  const value = typeof declared === "string" ? declared.trim() : "";
  if (!value) {
    throw new Error(
      `Workflow '${workflowKey}' must declare its licence in the frontmatter`,
    );
  }
  const license = LICENSE_BY_DECLARED_ID.get(value.toLowerCase());
  if (!license) {
    throw new Error(
      `Workflow '${workflowKey}' declares licence ${quoted(value)}, which the ` +
        `catalog does not accept (accepted: ${WORKFLOW_LICENSES.join(", ")})`,
    );
  }
  return license;
}

/**
 * The confirmation flag. On unless MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES
 * is explicitly false; an unrecognised value keeps it on.
 */
export function confirmedLicensesRequired(
  options: Pick<WorkflowCatalogSourceOptions, "requireConfirmedLicenses"> = {},
): boolean {
  if (options.requireConfirmedLicenses !== undefined) {
    return options.requireConfirmedLicenses;
  }
  const value = process.env.MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES?.trim()
    .toLowerCase();
  return !(value === "false" || value === "0" || value === "no" || value === "off");
}

function githubHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "mike-workflow-sync",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** A setting that is present and not blank; dotenv turns `KEY=` into "". */
function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sourceConfiguration(options: WorkflowCatalogSourceOptions) {
  const repository =
    configured(options.repository) ??
    configured(process.env.MIKE_WORKFLOWS_REPOSITORY) ??
    DEFAULT_REPOSITORY;
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(
      "MIKE_WORKFLOWS_REPOSITORY must use the owner/repository form",
    );
  }
  let ref =
    configured(options.ref) ?? configured(process.env.MIKE_WORKFLOWS_REF);
  if (ref === undefined) {
    if (repository.toLowerCase() !== DEFAULT_REPOSITORY.toLowerCase()) {
      throw new Error(
        "MIKE_WORKFLOWS_REF must be set when MIKE_WORKFLOWS_REPOSITORY names " +
          "a catalog other than the pinned default",
      );
    }
    ref = DEFAULT_REF;
  }
  if (ref.length > 200) {
    throw new Error("MIKE_WORKFLOWS_REF must be between 1 and 200 characters");
  }
  if (/^[0-9a-f]{40}$/i.test(ref)) ref = ref.toLowerCase();
  // A branch or tag can move after a release; only a commit names exactly
  // the catalog that was reviewed.
  if (process.env.NODE_ENV === "production" && !COMMIT_PATTERN.test(ref)) {
    throw new Error(
      "MIKE_WORKFLOWS_REF must be a 40-character commit SHA in production; " +
        "branch and tag names are refused",
    );
  }
  const githubToken =
    options.githubToken ?? process.env.MIKE_WORKFLOWS_GITHUB_TOKEN;
  return { repository, ref, githubToken };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
}

export async function resolveWorkflowSourceCommit(
  options: WorkflowCatalogSourceOptions = {},
): Promise<{ repository: string; ref: string; commit: string }> {
  const { repository, ref, githubToken } = sourceConfiguration(options);
  if (COMMIT_PATTERN.test(ref)) return { repository, ref, commit: ref };
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
    { headers: githubHeaders(githubToken) },
    fetchImpl,
  );
  if (!response.ok) {
    throw new Error(
      `Could not resolve ${repository}@${ref}: GitHub returned ${response.status}`,
    );
  }
  const payload = asRecord(await response.json(), "GitHub commit response");
  const commit = requiredString(payload.sha, "GitHub commit SHA");
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("GitHub returned an invalid workflow source commit SHA");
  }
  return { repository, ref, commit };
}

async function downloadArchive(
  archivePath: string,
  repository: string,
  commit: string,
  options: WorkflowCatalogSourceOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    `https://codeload.github.com/${repository}/zip/${commit}`,
    { headers: githubHeaders(options.githubToken) },
    fetchImpl,
  );
  if (!response.ok) {
    throw new Error(
      `Could not download ${repository}@${commit}: GitHub returned ${response.status}`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) {
    throw new Error(
      "Mike workflows archive exceeds the 10 MB compressed limit",
    );
  }
  if (!response.body) {
    throw new Error("GitHub returned an empty Mike workflows archive");
  }
  const archive = await open(archivePath, "wx", 0o600);
  const reader = response.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new Error(
          "Mike workflows archive exceeds the 10 MB compressed limit",
        );
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await archive.write(
          value,
          offset,
          value.byteLength - offset,
        );
        if (bytesWritten === 0) {
          throw new Error("Could not write the Mike workflows archive");
        }
        offset += bytesWritten;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    await archive.close();
  }
}

// JSZip resolves "." and ".." segments while loading and keeps the name as
// written in `unsafeOriginalName`, so an entry such as
// "assistant-workflows/x/assets/../../y" would otherwise land silently at
// "y". Every entry must name its own location exactly.
function unsafeArchivePath(name: string): boolean {
  if (!name || /[\\\0]/.test(name)) return true;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return true;
  return name
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function archiveFiles(zip: JSZip): Map<string, JSZipObject> {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    if (unsafeArchivePath(original)) {
      throw new Error(
        `Workflow archive contains an unsafe path ${quoted(original)}: ` +
          "every file must stay inside its own folder",
      );
    }
  }
  const first = entries[0]?.name;
  if (!first?.includes("/"))
    throw new Error("Workflow archive has no root directory");
  const root = first.slice(0, first.indexOf("/") + 1);
  const files = new Map<string, JSZipObject>();
  for (const entry of entries) {
    if (!entry.name.startsWith(root)) {
      throw new Error("Workflow archive contains multiple root directories");
    }
    const relative = entry.name.slice(root.length);
    if (
      !relative ||
      relative.startsWith("/") ||
      relative.split("/").includes("..")
    ) {
      throw new Error("Workflow archive contains an unsafe path");
    }
    files.set(relative, entry);
  }
  return files;
}

function declaredEntrySize(entry: JSZipObject): number | null {
  const data = (
    entry as JSZipObject & {
      _data?: { uncompressedSize?: unknown };
    }
  )._data;
  return typeof data?.uncompressedSize === "number"
    ? data.uncompressedSize
    : null;
}

function unixMode(entry: JSZipObject): number | null {
  const mode = entry.unixPermissions;
  if (typeof mode === "number") return mode;
  if (typeof mode === "string" && /^[0-7]+$/.test(mode)) {
    return Number.parseInt(mode, 8);
  }
  return null;
}

function inCollection(entryPath: string): boolean {
  return COLLECTION_PREFIXES.some((prefix) => entryPath.startsWith(prefix));
}

/** The workflow (or, failing that, the folder) a collection file belongs to. */
function ownerOf(entryPath: string, files: Map<string, JSZipObject>): string {
  const segments = entryPath.split("/");
  for (let end = segments.length - 1; end >= 2; end -= 1) {
    const directory = segments.slice(0, end).join("/");
    if (files.has(`${directory}/SKILL.md`)) {
      return `Workflow '${segments[end - 1]}'`;
    }
  }
  return `Workflow folder ${quoted(segments.slice(0, -1).join("/"))}`;
}

/** The lower-cased extension of a file name, without the dot ("" for none). */
function extensionOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return (
    bytes.byteLength >= prefix.byteLength &&
    bytes.subarray(0, prefix.byteLength).equals(prefix)
  );
}

// Applies the never-ship rules to every file under a collection, including
// files the parser itself never reads, so a published workflow folder holds
// nothing executable.
function refuseUnshippableFiles(files: Map<string, JSZipObject>): void {
  for (const [entryPath, entry] of files) {
    if (!inCollection(entryPath)) continue;
    const segments = entryPath.split("/");
    const owner = () => ownerOf(entryPath, files);
    if (segments.some((segment) => /[. ]$/.test(segment))) {
      throw new Error(
        `${owner()} has a name that ends in a dot or a space ` +
          `(${quoted(entryPath)}); Windows drops those characters, which ` +
          "can change a file's type",
      );
    }
    const folder = segments
      .slice(1, -1)
      .find((segment) => NEVER_SHIP_FOLDERS.has(segment.toLowerCase()));
    if (folder) {
      throw new Error(
        `${owner()} contains a ${folder}/ folder (${quoted(entryPath)}); ` +
          "scripts and tooling never ship with a workflow",
      );
    }
    const mode = unixMode(entry);
    if (mode !== null && (mode & FILE_TYPE_MASK) === SYMLINK_TYPE) {
      throw new Error(
        `${owner()} contains a symlink (${quoted(entryPath)}); ` +
          "workflow files must be regular files",
      );
    }
    const filename = segments.at(-1)!.toLowerCase();
    if (NEVER_SHIP_EXTENSIONS.has(extensionOf(filename))) {
      throw new Error(
        `${owner()} contains a file type that never ships with a workflow ` +
          `(${quoted(entryPath)}): scripts, executables, markup and ` +
          "macro-enabled Office files are refused",
      );
    }
    if (
      NEVER_SHIP_FILENAMES.has(filename) ||
      REQUIREMENTS_FILENAME.test(filename)
    ) {
      throw new Error(
        `${owner()} contains a build or package file (${quoted(entryPath)}); ` +
          "these never ship with a workflow",
      );
    }
    if (mode !== null && (mode & EXECUTABLE_BITS) !== 0) {
      throw new Error(
        `${owner()} contains an executable file (${quoted(entryPath)}); ` +
          "these never ship with a workflow",
      );
    }
  }
}

// An Office Open XML file declares the type of each of its parts in
// [Content_Types].xml. A VBA project part, or a macro-enabled main part,
// makes it a .docm, .xlsm or .pptm under another name.
async function officeOpenXmlProblem(
  bytes: Buffer,
): Promise<"invalid" | "macros" | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return "invalid";
  }
  const contentTypes = zip.file("[Content_Types].xml");
  if (!contentTypes) return "invalid";
  const declared = declaredEntrySize(contentTypes);
  if (declared === null || declared > MAX_CONTENT_TYPES_BYTES) return "invalid";
  let text: string;
  try {
    text = await contentTypes.async("string");
  } catch {
    return "invalid";
  }
  if (text.length > MAX_CONTENT_TYPES_BYTES) return "invalid";
  const lower = text.toLowerCase();
  if (
    lower.includes("vbaproject") ||
    lower.includes("macroenabled") ||
    Object.keys(zip.files).some((name) =>
      name.toLowerCase().endsWith("vbaproject.bin"),
    )
  ) {
    return "macros";
  }
  return null;
}

/**
 * The type of an asset that may ship, or an error naming the workflow when
 * the asset's name, type or content is refused.
 */
async function checkedAssetType(
  workflowKey: string,
  assetPath: string,
  bytes: Buffer,
): Promise<string> {
  const filename = assetPath.slice(assetPath.lastIndexOf("/") + 1);
  const label = `Workflow '${workflowKey}' asset ${quoted(assetPath)}`;
  if (UNSAFE_NAME_CHARACTERS.test(filename) || filename.trim() !== filename) {
    throw new Error(
      `${label} has a name that would change on a user's disk: a control ` +
        `character, a space at either end, or one of <>:"|?*\\`,
    );
  }
  const fileType = extensionOf(filename);
  const signature = ASSET_SIGNATURES.get(fileType);
  if (!signature) {
    throw new Error(
      `${label} is not a document type the catalog ships ` +
        `(${WORKFLOW_ASSET_TYPES.join(", ")})`,
    );
  }
  if (EXECUTABLE_SIGNATURES.some((prefix) => startsWith(bytes, prefix))) {
    throw new Error(
      `${label} is a script or executable; these never ship with a workflow`,
    );
  }
  if (!startsWith(bytes, signature)) {
    throw new Error(`${label} is not a .${fileType} file`);
  }
  if (OFFICE_OPEN_XML_TYPES.has(fileType)) {
    const problem = await officeOpenXmlProblem(bytes);
    if (problem === "invalid") {
      throw new Error(`${label} is not a .${fileType} file`);
    }
    if (problem === "macros") {
      throw new Error(
        `${label} contains macros; these never ship with a workflow`,
      );
    }
  }
  return fileType;
}

async function parseArchive(
  archivePath: string,
  assetDirectory: string,
  repository: string,
  ref: string,
  commit: string,
  policy: { requireConfirmedLicenses: boolean },
): Promise<WorkflowCatalogSourceDocument> {
  const zip = await JSZip.loadAsync(await readFile(archivePath));
  const files = archiveFiles(zip);
  refuseUnshippableFiles(files);
  let extractedBytes = 0;
  const textCache = new Map<string, string>();

  async function readEntry(entryPath: string): Promise<Buffer> {
    const entry = files.get(entryPath);
    if (!entry) throw new Error(`Workflow archive is missing ${entryPath}`);
    const declared = declaredEntrySize(entry);
    if (declared !== null && declared > MAX_FILE_BYTES) {
      throw new Error(`${entryPath} exceeds the 5 MB per-file limit`);
    }
    const contents = await entry.async("nodebuffer");
    if (contents.byteLength > MAX_FILE_BYTES) {
      throw new Error(`${entryPath} exceeds the 5 MB per-file limit`);
    }
    extractedBytes += contents.byteLength;
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("Workflow archive exceeds the 50 MB extracted limit");
    }
    return contents;
  }

  async function readText(entryPath: string): Promise<string> {
    const cached = textCache.get(entryPath);
    if (cached !== undefined) return cached;
    const value = (await readEntry(entryPath)).toString("utf8");
    textCache.set(entryPath, value);
    return value;
  }

  // The licence file in `directory` ("" for the archive root), if one exists
  // and has some text in it.
  async function licenceFileIn(directory: string): Promise<string | null> {
    for (const name of LICENSE_FILENAMES) {
      const entryPath = directory ? `${directory}/${name}` : name;
      if (!files.has(entryPath)) continue;
      if (normalizedText(await readText(entryPath))) return entryPath;
    }
    return null;
  }

  // NOTICE and CHANGES.md travel with the catalog row, so they are capped
  // well below the per-file limit.
  async function companionText(
    directory: string,
    names: readonly string[],
    workflowKey: string,
  ): Promise<string | null> {
    for (const name of names) {
      const entryPath = `${directory}/${name}`;
      const entry = files.get(entryPath);
      if (!entry) continue;
      const tooLarge = () =>
        new Error(`Workflow '${workflowKey}' ${name} exceeds the 256 KB limit`);
      const declared = declaredEntrySize(entry);
      if (declared !== null && declared > MAX_NOTICE_BYTES) throw tooLarge();
      const text = normalizedText(await readText(entryPath));
      if (Buffer.byteLength(text, "utf8") > MAX_NOTICE_BYTES) throw tooLarge();
      return text || null;
    }
    return null;
  }

  const skillPaths = [...files.keys()]
    .filter(
      (entryPath) =>
        inCollection(entryPath) && entryPath.endsWith("/SKILL.md"),
    )
    .sort((a, b) => a.localeCompare(b, "en"));
  if (!skillPaths.length)
    throw new Error("Workflow archive contains no workflows");
  if (skillPaths.length > MAX_WORKFLOWS) {
    throw new Error("Workflow archive exceeds the 1,000 workflow limit");
  }

  // The repository's own licence covers workflows that carry no licence
  // metadata of their own, such as the vendored defaults.
  const rootLicenseFile = await licenceFileIn("");

  const packCache = new Map<string, ParsedPack>();
  const discoveredPackWorkflows = new Map<string, Set<string>>();
  const seenKeys = new Set<string>();
  const workflows: WorkflowCatalogSourceWorkflow[] = [];

  async function loadPack(
    collection: string,
    packDirectory: string,
    type: "assistant" | "tabular",
  ): Promise<ParsedPack> {
    const packPath = `${collection}/${packDirectory}/pack.yaml`;
    const cached = packCache.get(packPath);
    if (cached) return cached;
    const raw = parseYamlObject(await readText(packPath), packPath);
    const id = requiredString(raw.id, `${packPath}.id`);
    const pack = {
      key: `${type}:${id}`,
      title: requiredString(raw.title, `${packPath}.title`),
      description: requiredString(raw.description, `${packPath}.description`),
      version: requiredString(raw.version, `${packPath}.version`),
      workflowNames: stringArray(raw.workflows, `${packPath}.workflows`),
    };
    if (!pack.workflowNames.length) {
      throw new Error(`${packPath}.workflows must not be empty`);
    }
    if (
      pack.workflowNames.some((name) => !WORKFLOW_KEY_PATTERN.test(name)) ||
      new Set(pack.workflowNames).size !== pack.workflowNames.length
    ) {
      throw new Error(
        `${packPath}.workflows contains invalid or duplicate keys`,
      );
    }
    packCache.set(packPath, pack);
    return pack;
  }

  for (const skillPath of skillPaths) {
    const segments = skillPath.split("/");
    if (segments.length !== 3 && segments.length !== 4) {
      throw new Error(
        `${skillPath} has an unsupported workflow directory depth`,
      );
    }
    const collection = segments[0];
    let type: "assistant" | "tabular";
    if (collection === "assistant-workflows") type = "assistant";
    else if (collection === "tabular-review-workflows") type = "tabular";
    else throw new Error(`${skillPath} has an unsupported collection`);
    const workflowKey = segments.at(-2)!;
    if (!WORKFLOW_KEY_PATTERN.test(workflowKey)) {
      throw new Error(`${skillPath} has an invalid workflow key`);
    }
    if (seenKeys.has(workflowKey)) {
      throw new Error(
        `Workflow archive contains duplicate key '${workflowKey}'`,
      );
    }
    seenKeys.add(workflowKey);

    let pack: ParsedPack | null = null;
    if (segments.length === 4) {
      const packDirectory = segments[1];
      pack = await loadPack(collection, packDirectory, type);
      const packPath = `${collection}/${packDirectory}/pack.yaml`;
      const discovered =
        discoveredPackWorkflows.get(packPath) ?? new Set<string>();
      discovered.add(workflowKey);
      discoveredPackWorkflows.set(packPath, discovered);
      if (!pack.workflowNames.includes(workflowKey)) {
        throw new Error(
          `${packPath} does not list discovered workflow '${workflowKey}'`,
        );
      }
    }

    const { frontmatter, body } = parseSkill(
      await readText(skillPath),
      skillPath,
    );
    if (requiredString(frontmatter.name, `${skillPath}.name`) !== workflowKey) {
      throw new Error(`${skillPath}.name must match its directory`);
    }
    const license = canonicalWorkflowLicense(frontmatter.license, workflowKey);
    const metadata = asRecord(frontmatter.metadata, `${skillPath}.metadata`);
    const metadataType = requiredString(
      metadata["mike-type"],
      `${skillPath}.metadata.mike-type`,
    );
    if (metadataType !== type) {
      throw new Error(`${skillPath}.metadata.mike-type must be '${type}'`);
    }
    const availability = optionalString(
      metadata["mike-availability"],
      `${skillPath}.metadata.mike-availability`,
    );
    if (
      availability &&
      availability !== "system" &&
      availability !== "add-on"
    ) {
      throw new Error(`${skillPath}.metadata.mike-availability is invalid`);
    }

    const title = requiredString(
      metadata["mike-display-name"],
      `${skillPath}.metadata.mike-display-name`,
    );
    let prompt = body.trimStart();
    if (!prompt) throw new Error(`${skillPath} has no workflow instructions`);
    if (!prompt.startsWith("# ")) prompt = `# ${title}\n\n${prompt}`;

    let columnsConfig: unknown[] | null = null;
    if (type === "tabular") {
      const columnsPath = skillPath.replace(/SKILL\.md$/, "table-columns.yaml");
      const table = parseYamlObject(await readText(columnsPath), columnsPath);
      columnsConfig = validateColumnsConfig(
        table.columns,
        `${columnsPath}.columns`,
      );
    } else {
      const columnsPath = skillPath.replace(/SKILL\.md$/, "table-columns.yaml");
      if (files.has(columnsPath)) {
        throw new Error(
          `${columnsPath} is only supported for tabular workflows`,
        );
      }
    }

    const workflowDirectory = skillPath.slice(0, -"/SKILL.md".length);

    // Licence evidence. A workflow whose metadata declares where its licence
    // comes from (an adapted third-party work) carries its own LICENSE,
    // CHANGES.md and credit line. One without that metadata, such as a
    // vendored default, is covered by a licence file in its folder or at the
    // archive root.
    const declaredEvidence = optionalString(
      metadata["license-evidence"],
      `${skillPath}.metadata.license-evidence`,
    );
    if (
      declaredEvidence !== null &&
      declaredEvidence !== "file" &&
      declaredEvidence !== "manifest-only"
    ) {
      throw new Error(
        `Workflow '${workflowKey}' has an invalid license-evidence ` +
          `${quoted(declaredEvidence)}; use file or manifest-only`,
      );
    }
    const authorConfirmation = optionalString(
      metadata["author-confirmation"],
      `${skillPath}.metadata.author-confirmation`,
    );
    const confirmedOn = authorConfirmation?.match(CONFIRMED_PATTERN)?.[1];
    if (
      authorConfirmation !== null &&
      authorConfirmation !== "not-required" &&
      authorConfirmation !== "pending" &&
      !(confirmedOn && isCalendarDate(confirmedOn))
    ) {
      throw new Error(
        `Workflow '${workflowKey}' has an invalid author-confirmation ` +
          `${quoted(authorConfirmation)}; use not-required, pending or ` +
          "confirmed YYYY-MM-DD",
      );
    }
    const ownLicenseFile = await licenceFileIn(workflowDirectory);
    if (declaredEvidence !== null && !ownLicenseFile) {
      throw new Error(
        `Workflow '${workflowKey}' declares license-evidence but its folder ` +
          "has no LICENSE file",
      );
    }
    const licenseFile = ownLicenseFile ?? rootLicenseFile;
    if (!licenseFile) {
      throw new Error(
        `Workflow '${workflowKey}' has no licence file: add a LICENSE to its ` +
          "folder or to the root of the catalog",
      );
    }
    const licenseEvidence: WorkflowLicenseEvidence =
      declaredEvidence ?? "file";
    if (policy.requireConfirmedLicenses) {
      if (authorConfirmation === "pending") {
        throw new Error(
          `Workflow '${workflowKey}' is waiting for its author to confirm the ` +
            "licence (author-confirmation: pending) and cannot be published yet",
        );
      }
      if (licenseEvidence === "manifest-only" && !confirmedOn) {
        throw new Error(
          `Workflow '${workflowKey}' declares its licence only in a manifest; ` +
            "it needs author-confirmation 'confirmed YYYY-MM-DD' before it " +
            "can be published",
        );
      }
    }
    const attribution = optionalString(
      metadata.attribution,
      `${skillPath}.metadata.attribution`,
    );
    if (attribution && attribution.length > MAX_ATTRIBUTION_LENGTH) {
      throw new Error(
        `Workflow '${workflowKey}' attribution exceeds ${MAX_ATTRIBUTION_LENGTH} characters`,
      );
    }
    const noticeMd = await companionText(
      workflowDirectory,
      NOTICE_FILENAMES,
      workflowKey,
    );
    const changesMd = await companionText(
      workflowDirectory,
      [CHANGES_FILENAME],
      workflowKey,
    );
    if (declaredEvidence !== null) {
      if (!attribution) {
        throw new Error(
          `Workflow '${workflowKey}' declares license-evidence but has no ` +
            "attribution credit line",
        );
      }
      if (!changesMd) {
        throw new Error(
          `Workflow '${workflowKey}' declares license-evidence but its folder ` +
            `has no ${CHANGES_FILENAME}`,
        );
      }
    }
    const sourceRepository = optionalString(
      metadata["source-repository"],
      `${skillPath}.metadata.source-repository`,
    );
    if (sourceRepository && !REPOSITORY_PATTERN.test(sourceRepository)) {
      throw new Error(
        `Workflow '${workflowKey}' source-repository must use the ` +
          "owner/repository form",
      );
    }
    const sourceCommit = optionalString(
      metadata["source-commit"],
      `${skillPath}.metadata.source-commit`,
    );
    if (sourceCommit && !COMMIT_PATTERN.test(sourceCommit)) {
      throw new Error(
        `Workflow '${workflowKey}' source-commit must be a 40-character commit SHA`,
      );
    }
    const reviewBy = optionalString(
      metadata["review-by"],
      `${skillPath}.metadata.review-by`,
    );
    if (reviewBy && !isCalendarDate(reviewBy)) {
      throw new Error(
        `Workflow '${workflowKey}' review-by must be a date (YYYY-MM-DD)`,
      );
    }
    const provenance: WorkflowCatalogProvenance = {
      catalog_repository: repository,
      catalog_path: workflowDirectory,
      license_file: licenseFile,
      source_repository: sourceRepository,
      source_path: optionalString(
        metadata["source-path"],
        `${skillPath}.metadata.source-path`,
      ),
      source_commit: sourceCommit,
      source_name: optionalString(
        metadata["source-name"],
        `${skillPath}.metadata.source-name`,
      ),
      source_version: optionalString(
        metadata["source-version"],
        `${skillPath}.metadata.source-version`,
      ),
      review_by: reviewBy,
    };

    const assetPrefix = `${workflowDirectory}/assets/`;
    const assetPaths = [...files.keys()]
      .filter((entryPath) => {
        if (!entryPath.startsWith(assetPrefix)) return false;
        const filename = entryPath.slice(assetPrefix.length);
        return (
          !!filename && !filename.includes("/") && !filename.startsWith(".")
        );
      })
      .sort((a, b) => a.localeCompare(b, "en"));
    if (assetPaths.length > MAX_ASSETS_PER_WORKFLOW) {
      throw new Error(`${workflowKey} exceeds the 50 asset limit`);
    }
    const assets: WorkflowCatalogAssetSource[] = [];
    for (const [index, assetPath] of assetPaths.entries()) {
      const bytes = await readEntry(assetPath);
      // A script or binary with an innocent name is still refused.
      const fileType = await checkedAssetType(workflowKey, assetPath, bytes);
      const contentHash = sha256(bytes);
      const temporaryPath = path.join(
        assetDirectory,
        `${workflowKey}-${index}-${contentHash}`,
      );
      await writeFile(temporaryPath, bytes, { mode: 0o600 });
      assets.push({
        filename: assetPath.slice(assetPrefix.length),
        file_type: fileType,
        size_bytes: bytes.byteLength,
        content_hash: contentHash,
        temporary_path: temporaryPath,
      });
    }

    const defaultConfig = DEFAULT_WORKFLOW_BY_KEY.get(workflowKey) ?? null;
    const jurisdictions = requiredString(
      metadata.jurisdictions,
      `${skillPath}.metadata.jurisdictions`,
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!jurisdictions.length) {
      throw new Error(`${skillPath}.metadata.jurisdictions must not be empty`);
    }
    const payload = {
      workflow_key: workflowKey,
      distribution: defaultConfig ? ("default" as const) : ("addon" as const),
      version: requiredString(
        metadata.version,
        `${skillPath}.metadata.version`,
      ),
      title,
      description: requiredString(
        frontmatter.description,
        `${skillPath}.description`,
      ),
      type,
      prompt_md: prompt,
      columns_config: columnsConfig,
      contributors: [
        {
          name: requiredString(metadata.author, `${skillPath}.metadata.author`),
          organisation: optionalString(
            metadata["author-organisation"],
            `${skillPath}.metadata.author-organisation`,
          ),
          role: null,
          linkedin: null,
        },
      ],
      language: requiredString(
        metadata.language,
        `${skillPath}.metadata.language`,
      ),
      practice: requiredString(
        metadata.practice,
        `${skillPath}.metadata.practice`,
      ),
      jurisdictions,
      pack_key: pack?.key ?? null,
      pack_title: pack?.title ?? null,
      pack_description: pack?.description ?? null,
      pack_version: pack?.version ?? null,
      default_sort_order: defaultConfig?.sortOrder ?? null,
      quick_action_name: defaultConfig?.quickAction ? title : null,
      quick_action_prompt: defaultConfig?.quickAction
        ? DEFAULT_QUICK_ACTION_PROMPT
        : null,
      document_upload: defaultConfig?.quickAction === true,
      word_quick_action: defaultConfig?.wordQuickAction === true,
      word_quick_action_prompt: defaultConfig?.wordQuickAction
        ? DEFAULT_WORD_QUICK_ACTION_PROMPT
        : null,
      license,
      license_evidence: licenseEvidence,
      author_confirmation: authorConfirmation,
      attribution,
      provenance,
      notice_md: noticeMd,
      changes_md: changesMd,
      assets,
    };
    // The licence, credit and provenance are part of what a row is: a change
    // to any of them produces a new content-addressed catalog row.
    const hashPayload = {
      ...payload,
      assets: assets.map(({ temporary_path: _path, ...asset }) => asset),
    };
    workflows.push({
      ...payload,
      content_hash: sha256(JSON.stringify(hashPayload)),
    });
  }

  for (const workflow of DEFAULT_WORKFLOWS) {
    if (!seenKeys.has(workflow.key)) {
      throw new Error(
        `Workflow archive is missing required default '${workflow.key}'`,
      );
    }
  }

  for (const [packPath, pack] of packCache) {
    const discovered =
      discoveredPackWorkflows.get(packPath) ?? new Set<string>();
    for (const workflowName of pack.workflowNames) {
      if (!discovered.has(workflowName)) {
        throw new Error(`${packPath} lists missing workflow '${workflowName}'`);
      }
    }
  }

  return {
    source_repository: repository,
    source_ref: ref,
    source_commit: commit,
    workflows,
  };
}

function optionalDocumentString(
  value: unknown,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

export function validateWorkflowCatalogDocument(
  value: unknown,
): WorkflowCatalogSourceDocument {
  const document = asRecord(value, "Workflow catalog");
  const repository = requiredString(
    document.source_repository,
    "Workflow catalog source_repository",
  );
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Workflow catalog source_repository is invalid");
  }
  requiredString(document.source_ref, "Workflow catalog source_ref");
  const commit = requiredString(
    document.source_commit,
    "Workflow catalog source_commit",
  );
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("Workflow catalog source_commit is invalid");
  }
  if (!Array.isArray(document.workflows) || !document.workflows.length) {
    throw new Error("Workflow catalog contains no workflows");
  }
  if (document.workflows.length > MAX_WORKFLOWS) {
    throw new Error("Workflow catalog exceeds the 1,000 workflow limit");
  }
  const keys = new Set<string>();
  for (const item of document.workflows) {
    const workflow = asRecord(item, "Workflow catalog entry");
    const key = requiredString(workflow.workflow_key, "Workflow key");
    if (!WORKFLOW_KEY_PATTERN.test(key) || keys.has(key)) {
      throw new Error(
        `Workflow catalog contains invalid or duplicate key '${key}'`,
      );
    }
    keys.add(key);
    if (
      workflow.distribution !== "default" &&
      workflow.distribution !== "addon"
    ) {
      throw new Error(`Workflow '${key}' has an invalid distribution`);
    }
    if (workflow.type !== "assistant" && workflow.type !== "tabular") {
      throw new Error(`Workflow '${key}' has an invalid type`);
    }
    requiredString(workflow.title, `Workflow '${key}' title`);
    requiredString(workflow.prompt_md, `Workflow '${key}' prompt`);
    if (
      typeof workflow.content_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(workflow.content_hash)
    ) {
      throw new Error(`Workflow '${key}' has an invalid content hash`);
    }
    if (
      !(WORKFLOW_LICENSES as readonly unknown[]).includes(workflow.license)
    ) {
      throw new Error(`Workflow '${key}' has a licence the catalog does not accept`);
    }
    if (
      workflow.license_evidence !== "file" &&
      workflow.license_evidence !== "manifest-only"
    ) {
      throw new Error(`Workflow '${key}' has invalid licence evidence`);
    }
    for (const field of [
      "author_confirmation",
      "attribution",
      "notice_md",
      "changes_md",
    ]) {
      optionalDocumentString(workflow[field], `Workflow '${key}' ${field}`);
    }
    const provenance = asRecord(
      workflow.provenance,
      `Workflow '${key}' provenance`,
    );
    requiredString(
      provenance.catalog_path,
      `Workflow '${key}' provenance catalog_path`,
    );
    requiredString(
      provenance.license_file,
      `Workflow '${key}' provenance license_file`,
    );
    if (!Array.isArray(workflow.assets)) {
      throw new Error(`Workflow '${key}' has invalid assets`);
    }
    if (workflow.assets.length > MAX_ASSETS_PER_WORKFLOW) {
      throw new Error(`Workflow '${key}' exceeds the 50 asset limit`);
    }
    for (const item of workflow.assets) {
      const asset = asRecord(item, `Workflow '${key}' asset`);
      const filename = requiredString(
        asset.filename,
        `Workflow '${key}' asset filename`,
      );
      // Compared untrimmed: a name that ends in a space is refused, not tidied.
      if (
        filename !== asset.filename ||
        filename.startsWith(".") ||
        /[. ]$/.test(filename) ||
        UNSAFE_NAME_CHARACTERS.test(filename)
      ) {
        throw new Error(`Workflow '${key}' has an unsafe asset filename`);
      }
      const fileType = requiredString(
        asset.file_type,
        `Workflow '${key}' asset file type`,
      );
      if (
        !(WORKFLOW_ASSET_TYPES as readonly string[]).includes(fileType) ||
        asset.file_type !== fileType ||
        extensionOf(filename) !== fileType
      ) {
        throw new Error(`Workflow '${key}' has an asset type the catalog does not ship`);
      }
      if (
        !Number.isInteger(asset.size_bytes) ||
        (asset.size_bytes as number) < 0 ||
        (asset.size_bytes as number) > MAX_FILE_BYTES
      ) {
        throw new Error(`Workflow '${key}' has an invalid asset size`);
      }
      if (
        typeof asset.content_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(asset.content_hash)
      ) {
        throw new Error(`Workflow '${key}' has an invalid asset hash`);
      }
      requiredString(
        asset.temporary_path,
        `Workflow '${key}' asset temporary path`,
      );
    }
  }
  return value as WorkflowCatalogSourceDocument;
}

export async function prepareWorkflowCatalog(
  options: WorkflowCatalogSourceOptions = {},
): Promise<PreparedWorkflowCatalog> {
  const directory = await mkdtemp(
    path.join(options.temporaryRoot ?? tmpdir(), "mike-workflows-"),
  );
  try {
    const archivePath = path.join(directory, "source.zip");
    const assetDirectory = path.join(directory, "assets");
    await mkdir(assetDirectory, { mode: 0o700 });
    const { repository, ref, commit } =
      await resolveWorkflowSourceCommit(options);
    await downloadArchive(archivePath, repository, commit, options);
    const document = await parseArchive(
      archivePath,
      assetDirectory,
      repository,
      ref,
      commit,
      { requireConfirmedLicenses: confirmedLicensesRequired(options) },
    );
    const catalogPath = path.join(directory, "workflow-catalog.json");
    await writeFile(catalogPath, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
    });
    validateWorkflowCatalogDocument(
      JSON.parse(await readFile(catalogPath, "utf8")) as unknown,
    );
    return { directory, catalogPath, archivePath, sourceCommit: commit };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function removePreparedWorkflowCatalog(
  prepared: Pick<PreparedWorkflowCatalog, "directory">,
): Promise<void> {
  await rm(prepared.directory, { recursive: true, force: true });
}
