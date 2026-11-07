// SPDX-License-Identifier: AGPL-3.0-only
//
// validate:catalog — run Mike's own catalog parser over a local catalog
// checkout before any release. It zips the checkout, applies the size budget
// (warn at 7 MB, fail at 8 MB, the ceiling Mike's sync enforces), and feeds
// the archive through prepareWorkflowCatalog, which runs the licence, asset
// and never-ship gates and validateWorkflowCatalogDocument. Run after
// `npm run build --prefix backend` as `node dist/jobs/validateWorkflowCatalog.js`.

import { lstat, readFile, readdir } from "fs/promises";
import path from "path";
import { parseArgs } from "util";
import JSZip from "jszip";
import {
  prepareWorkflowCatalog,
  removePreparedWorkflowCatalog,
  validateWorkflowCatalogDocument,
  type WorkflowCatalogSourceDocument,
} from "../lib/workflowCatalogSource";

const WARN_BYTES = 7 * 1024 * 1024;
const FAIL_BYTES = 8 * 1024 * 1024;
const PLACEHOLDER_COMMIT = "0".repeat(40);

export class CatalogSizeBudgetError extends Error {
  constructor(readonly sizeBytes: number) {
    super(
      `Catalog archive is ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB, over the ` +
        `${(FAIL_BYTES / (1024 * 1024)).toFixed(0)} MB budget`,
    );
    this.name = "CatalogSizeBudgetError";
  }
}

export type SizeBudgetResult = { sizeBytes: number; warning: string | null };

/** The single place the 7/8 MB budget is decided. Throws over the ceiling. */
export function checkSizeBudget(sizeBytes: number): SizeBudgetResult {
  if (sizeBytes > FAIL_BYTES) throw new CatalogSizeBudgetError(sizeBytes);
  if (sizeBytes > WARN_BYTES) {
    return {
      sizeBytes,
      warning: `Catalog archive is ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB, approaching the 8 MB budget`,
    };
  }
  return { sizeBytes, warning: null };
}

async function collectFiles(root: string, base = root): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = path.join(root, entry.name);
    const stat = await lstat(full);
    if (stat.isDirectory()) {
      out.push(...(await collectFiles(full, base)));
    } else if (stat.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * Build a zip of the checkout under a single root directory, as GitHub's
 * codeload archive is shaped. Deflated so the size reflects the archive Mike
 * would actually download.
 */
export async function zipCatalog(
  checkoutRoot: string,
  commit: string,
): Promise<Buffer> {
  const relPaths = await collectFiles(checkoutRoot);
  const zip = new JSZip();
  const root = `catalog-${commit}`;
  const fixedDate = new Date("1980-01-01T00:00:00Z");
  for (const relPath of relPaths.sort((a, b) => a.localeCompare(b, "en"))) {
    const bytes = await readFile(path.join(checkoutRoot, relPath));
    zip.file(`${root}/${relPath}`, bytes, { date: fixedDate, unixPermissions: 0o644 });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
}

export type ValidateCatalogOptions = {
  checkoutRoot: string;
  commit?: string;
  requireConfirmedLicenses?: boolean;
  temporaryRoot?: string;
};

export type ValidateCatalogResult = {
  document: WorkflowCatalogSourceDocument;
  sizeBytes: number;
  warning: string | null;
  workflowCount: number;
};

/**
 * Validate a catalog checkout end to end: size budget, then the real catalog
 * parser (never-ship, licence and asset gates) and document validation.
 */
export async function validateCatalog(
  options: ValidateCatalogOptions,
): Promise<ValidateCatalogResult> {
  const commit = options.commit ?? PLACEHOLDER_COMMIT;
  const archive = await zipCatalog(options.checkoutRoot, commit);
  const budget = checkSizeBudget(archive.byteLength);
  const fetchImpl = (async () =>
    new Response(new Uint8Array(archive), {
      status: 200,
      headers: { "content-length": String(archive.byteLength) },
    })) as unknown as typeof fetch;
  const prepared = await prepareWorkflowCatalog({
    repository: "local/catalog",
    ref: commit,
    fetchImpl,
    temporaryRoot: options.temporaryRoot,
    requireConfirmedLicenses: options.requireConfirmedLicenses ?? true,
  });
  try {
    const document = validateWorkflowCatalogDocument(
      JSON.parse(await readFile(prepared.catalogPath, "utf8")) as unknown,
    );
    return {
      document,
      sizeBytes: budget.sizeBytes,
      warning: budget.warning,
      workflowCount: document.workflows.length,
    };
  } finally {
    await removePreparedWorkflowCatalog(prepared);
  }
}

function parseValidateArgs(argv: string[]): ValidateCatalogOptions & { catalog: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      catalog: { type: "string" },
      commit: { type: "string" },
      "allow-unconfirmed": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (!values.catalog) throw new Error("validate:catalog needs --catalog <checkout>");
  return {
    catalog: values.catalog,
    checkoutRoot: values.catalog,
    commit: values.commit,
    requireConfirmedLicenses: !(values["allow-unconfirmed"] ?? false),
  };
}

async function main(): Promise<void> {
  const options = parseValidateArgs(process.argv.slice(2));
  const result = await validateCatalog(options);
  if (result.warning) console.warn(result.warning);
  console.log(
    `validate:catalog: ${result.workflowCount} workflow(s), archive ` +
      `${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB, all gates passed`,
  );
}

if (process.argv[1] && /validateWorkflowCatalog\.(ts|js)$/.test(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
