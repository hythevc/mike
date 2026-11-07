// SPDX-License-Identifier: AGPL-3.0-only
//
// convert:legal-skills — turn a checkout of the source skills plus the
// per-workflow conversion manifests into a catalog of Mike workflow entries.
// Deterministic: the same inputs always write the same bytes, and `--check`
// re-runs the conversion and reports any drift from what is on disk instead
// of writing. Run after `npm run build --prefix backend` as
// `node dist/jobs/convertLegalSkills.js`.

import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { parseArgs } from "util";
import { brand } from "../lib/brand.generated";
import {
  convertWorkflow,
  type ConvertContext,
  type EditsManifest,
  type WorkflowManifest,
} from "../lib/skillConversion/convert";
import {
  readSkillSource,
  safeYamlLoad,
  SkillConversionError,
} from "../lib/skillConversion/sourceReader";

// The source list is pinned; conversionSpec fixes this commit of
// hythevc/awesome-legal-skills and the catalog is reproduced from it.
const DEFAULT_SOURCE_COMMIT = "f9f28cdccbeb98bbdde010042ea9f525ca427c72";
// Fixed so DOCX and ZIP timestamps do not depend on when the job runs.
const DEFAULT_MODIFIED_ON = "2026-10-31";
const DEFAULT_CATALOG_URL = "https://github.com/[organisation]/[product]-workflows";
const DEFAULT_RELEASE_TAG = "catalog-unreleased";

export type ConvertCatalogOptions = {
  /** Root of the source checkout; it must contain a `skills/` directory. */
  sourceRoot: string;
  /** Directory of per-workflow manifests: `<key>/workflow.yaml` (+ edits.yaml). */
  conversionRoot: string;
  /** Catalog output root (written, or compared against in check mode). */
  outRoot: string;
  check: boolean;
  company: string;
  catalogRepositoryUrl: string;
  releaseTag: string;
  sourceCommit: string;
  modifiedOn: string;
};

export type DriftReport = {
  changed: string[];
  missing: string[];
  written: string[];
};

type PackManifest = {
  collection: "assistant" | "tabular";
  title: string;
  description: string;
  version: string;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML object`);
  }
  return value as Record<string, unknown>;
}

async function loadManifest(
  conversionRoot: string,
  key: string,
): Promise<{ manifest: WorkflowManifest; edits: EditsManifest }> {
  const workflowPath = path.join(conversionRoot, key, "workflow.yaml");
  const manifest = safeYamlLoad(
    await readFile(workflowPath, "utf8"),
    key,
    "workflow.yaml",
  ) as WorkflowManifest;
  let edits: EditsManifest = { edits: [] };
  const editsPath = path.join(conversionRoot, key, "edits.yaml");
  const editsText = await readFile(editsPath, "utf8").catch(() => null);
  if (editsText !== null) {
    const parsed = asRecord(safeYamlLoad(editsText, key, "edits.yaml"), "edits.yaml");
    edits = { edits: Array.isArray(parsed.edits) ? (parsed.edits as EditsManifest["edits"]) : [] };
  }
  return { manifest, edits };
}

function packYaml(
  packId: string,
  collectionDir: string,
  pack: PackManifest,
  memberKeys: string[],
  sourceCommit: string,
): string {
  const sorted = [...memberKeys].sort((a, b) => a.localeCompare(b, "en"));
  return [
    "$schema: ../../workflow-schema/pack.schema.yaml",
    `id: ${packId}`,
    `title: ${JSON.stringify(pack.title)}`,
    `description: ${JSON.stringify(pack.description)}`,
    "publisher:",
    `  name: ${JSON.stringify(brandCompany())}`,
    `  url: ${JSON.stringify(brand.marketingUrl)}`,
    "license: LicenseRef-per-workflow",
    `version: ${JSON.stringify(pack.version)}`,
    "source:",
    `  repo: https://github.com/hythevc/awesome-legal-skills`,
    `  ref: ${sourceCommit}`,
    "workflows:",
    ...sorted.map((key) => `  - ${key}`),
    "required_connectors: []",
    `# collection: ${collectionDir}`,
    "",
  ].join("\n");
}

function brandCompany(): string {
  return brand.legalEntityName;
}

/**
 * Convert every workflow named by the manifests, returning the full set of
 * output files keyed by their catalog-relative path. Pure given its inputs.
 */
export async function buildCatalogFiles(
  options: ConvertCatalogOptions,
): Promise<Map<string, Buffer>> {
  const packsText = await readFile(
    path.join(options.conversionRoot, "packs.yaml"),
    "utf8",
  );
  const packsDoc = asRecord(
    safeYamlLoad(packsText, "packs", "packs.yaml"),
    "packs.yaml",
  );
  const packs = asRecord(packsDoc.packs, "packs.yaml packs") as Record<string, PackManifest>;

  const entries = await readdir(options.conversionRoot, { withFileTypes: true });
  const keys = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));

  const context: ConvertContext = {
    company: options.company,
    catalogRepositoryUrl: options.catalogRepositoryUrl,
    releaseTag: options.releaseTag,
    sourceCommit: options.sourceCommit,
    modifiedOn: options.modifiedOn,
    docxDate: new Date(`${options.modifiedOn}T00:00:00Z`),
  };

  const files = new Map<string, Buffer>();
  const packMembers = new Map<string, { collectionDir: string; keys: string[] }>();
  for (const key of keys) {
    const { manifest, edits } = await loadManifest(options.conversionRoot, key);
    if (!packs[manifest.pack]) {
      throw new SkillConversionError(key, "packs.yaml", `names pack '${manifest.pack}', which packs.yaml does not define`);
    }
    const source = await readSkillSource(path.join(options.sourceRoot, "skills"), manifest.sourceSkill);
    const result = await convertWorkflow(source, manifest, edits, context);
    for (const [filePath, bytes] of result.files) files.set(filePath, bytes);
    const packKey = `${result.collection}/${result.pack}`;
    const existing = packMembers.get(packKey) ?? { collectionDir: result.collection, keys: [] };
    existing.keys.push(result.key);
    packMembers.set(packKey, existing);
  }

  for (const [packKey, members] of packMembers) {
    const [collectionDir, packId] = packKey.split("/");
    const pack = packs[packId];
    files.set(
      `${collectionDir}/${packId}-pack/pack.yaml`,
      Buffer.from(packYaml(packId, collectionDir, pack, members.keys, options.sourceCommit), "utf8"),
    );
  }
  return files;
}

/** Write the catalog files under the output root, creating directories. */
export async function writeCatalog(
  outRoot: string,
  files: Map<string, Buffer>,
): Promise<string[]> {
  const written: string[] = [];
  for (const relPath of [...files.keys()].sort((a, b) => a.localeCompare(b, "en"))) {
    const target = path.join(outRoot, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, files.get(relPath)!);
    written.push(relPath);
  }
  return written;
}

/** Compare freshly-built files against what is on disk, reporting drift. */
export async function checkCatalog(
  outRoot: string,
  files: Map<string, Buffer>,
): Promise<DriftReport> {
  const changed: string[] = [];
  const missing: string[] = [];
  for (const relPath of [...files.keys()].sort((a, b) => a.localeCompare(b, "en"))) {
    const target = path.join(outRoot, relPath);
    const onDisk = await readFile(target).catch(() => null);
    if (onDisk === null) {
      missing.push(relPath);
    } else if (!onDisk.equals(files.get(relPath)!)) {
      changed.push(relPath);
    }
  }
  return { changed, missing, written: [] };
}

export async function runConvert(options: ConvertCatalogOptions): Promise<DriftReport> {
  const files = await buildCatalogFiles(options);
  if (options.check) {
    return checkCatalog(options.outRoot, files);
  }
  const written = await writeCatalog(options.outRoot, files);
  return { changed: [], missing: [], written };
}

function parseConvertArgs(argv: string[]): ConvertCatalogOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      conversion: { type: "string" },
      out: { type: "string" },
      check: { type: "boolean", default: false },
      company: { type: "string" },
      "catalog-url": { type: "string" },
      "release-tag": { type: "string" },
      commit: { type: "string" },
      date: { type: "string" },
    },
    allowPositionals: false,
  });
  if (!values.source || !values.out) {
    throw new Error("convert:legal-skills needs --source and --out");
  }
  return {
    sourceRoot: values.source,
    conversionRoot: values.conversion ?? path.join(values.source, "conversion"),
    outRoot: values.out,
    check: values.check ?? false,
    company: values.company ?? brandCompany(),
    catalogRepositoryUrl: values["catalog-url"] ?? DEFAULT_CATALOG_URL,
    releaseTag: values["release-tag"] ?? DEFAULT_RELEASE_TAG,
    sourceCommit: values.commit ?? DEFAULT_SOURCE_COMMIT,
    modifiedOn: values.date ?? DEFAULT_MODIFIED_ON,
  };
}

async function main(): Promise<void> {
  const options = parseConvertArgs(process.argv.slice(2));
  const report = await runConvert(options);
  if (options.check) {
    const drift = [...report.missing, ...report.changed];
    if (drift.length) {
      console.error(
        `convert:legal-skills --check found drift in ${drift.length} file(s):\n` +
          [...report.missing.map((p) => `  missing: ${p}`), ...report.changed.map((p) => `  changed: ${p}`)].join("\n"),
      );
      process.exit(1);
    }
    console.log("convert:legal-skills --check: no drift");
    return;
  }
  console.log(`convert:legal-skills wrote ${report.written.length} file(s) to ${options.outRoot}`);
}

// Run only as a CLI, not when imported by a test.
if (process.argv[1] && /convertLegalSkills\.(ts|js)$/.test(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
