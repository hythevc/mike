// SPDX-License-Identifier: AGPL-3.0-only
//
// Editable copies of catalog workflows. Importing an add-on and duplicating a
// built-in are one operation: the copy keeps the licence, credit and source
// of the catalog workflow it came from, read-only from then on, and the
// catalog's assets reach the user's library through the documents module, as
// any other workflow asset does.
//
// Topic file of the workflows module: it takes an explicit `Db`, returns
// typed results, and never imports express. The facade (workflows.service.ts)
// re-exports what the routes need.

import { createHash, randomUUID } from "crypto";
import type {
  WorkflowCatalogCopy,
  WorkflowCatalogStatus,
  WorkflowLicense,
  WorkflowProvenance,
} from "@mike/contracts";
import {
  copyDocumentVersionFiles,
  createDocumentVersions,
} from "../documents/documents.service";
import { AppError } from "../../lib/appError";
import { convertedPdfKey } from "../../lib/convert";
import { enqueueStorageCleanup } from "../../lib/dbq/enqueue";
import { prepareDocumentDisplay } from "../../lib/documentDisplay";
import { shouldConvertToPdf } from "../../lib/documentTypes";
import {
  failure,
  internalFailure,
  ok,
  type ServiceFailure,
} from "../../lib/serviceResult";
import { bestEffort } from "../../lib/observability/sentry";
import { downloadFile, storageKey, uploadFile } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import {
  catalogKeyFromWorkflowId,
  findActiveCatalogVersions,
} from "../../lib/workflowCatalog";
import {
  normalizeContributors,
  normalizeOptionalString,
  withDatabaseWorkflow,
} from "./workflows.serialization";
import type { WorkflowRecord } from "./workflows.types";

/** Shown beside the credit once a copy's instructions or columns change. */
export const CATALOG_MODIFICATION_NOTICE = "Modified by your organisation";

/** The freshly inserted `workflows` row of a copy, handed back raw. */
export type CatalogWorkflowCopy = Record<string, unknown> & {
  id: string;
  user_id: string | null;
};

// Copying the catalog's assets can fail after the workflow row exists. That
// path is its own failure kind because it answers 500 with a SPECIFIC detail
// rather than the opaque internal-error body `sendServiceFailure` produces
// for kind "error".
export type CatalogCopyFailure =
  | ServiceFailure
  | {
      ok: false;
      kind: "assets_copy_failed";
      detail: string;
      /** What went wrong, for the route's report; never for the response. */
      error: AppError;
    };

export type CatalogCopyResult =
  | { ok: true; data: CatalogWorkflowCopy }
  | CatalogCopyFailure;

/** How the copy was asked for: an add-on import or a built-in duplicate. */
type CatalogCopyOrigin = "addon" | "builtin";

const ASSET_COPY_FAILURE = {
  addon: {
    detail: "Failed to copy add-on assets",
    kind: "workflows.addon_failed",
    message: "Workflow add-on assets could not be copied",
  },
  builtin: {
    detail: "Failed to copy workflow assets",
    kind: "workflows.duplicate_failed",
    message: "Built-in workflow assets could not be copied",
  },
} as const;

type CatalogAssetRow = {
  filename: string;
  file_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  content_hash: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Object keys sorted at every level, so the same instructions and columns
// always hash alike whatever order a client or the database returns them in.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** SHA-256 of a workflow's body: its instructions and its columns. */
export function workflowBodySha256(
  promptMd: unknown,
  columnsConfig: unknown,
): string {
  return createHash("sha256")
    .update(
      stableJson({
        columns_config: columnsConfig ?? null,
        prompt_md: typeof promptMd === "string" ? promptMd : null,
      }),
    )
    .digest("hex");
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value: string) {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * Semantic-version precedence: negative when `a` is older than `b`, positive
 * when newer, 0 when equal. Null when either is not a semantic version.
 */
export function compareCatalogVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = left.core[index] - right.core[index];
    if (difference !== 0) return Math.sign(difference);
  }
  // A release ranks above its own pre-releases.
  if (!left.prerelease.length || !right.prerelease.length) {
    return (
      (left.prerelease.length ? 0 : 1) - (right.prerelease.length ? 0 : 1)
    );
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const difference = Number(l) - Number(r);
      if (difference !== 0) return Math.sign(difference);
    } else if (lNumeric !== rNumeric) {
      return lNumeric ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/**
 * How a copy made at `copyVersion` stands against the active catalog, which
 * serves `activeVersion` for its key (undefined: the key is no longer in the
 * catalog). Versions that are not semantic versions and differ count as an
 * update, since their order cannot be known.
 */
export function catalogStatusFor(
  copyVersion: string | null,
  activeVersion: string | null | undefined,
): WorkflowCatalogStatus {
  if (activeVersion === undefined) return "withdrawn";
  if (activeVersion === null || activeVersion === copyVersion) return "current";
  if (copyVersion === null) return "update_available";
  const order = compareCatalogVersions(activeVersion, copyVersion);
  if (order === null) return "update_available";
  return order > 0 ? "update_available" : "current";
}

const NOT_A_CATALOG_COPY: WorkflowCatalogCopy = Object.freeze({
  catalog_workflow_key: null,
  catalog_version: null,
  license: null,
  attribution: null,
  provenance: null,
  catalog_status: null,
  catalog_latest_version: null,
  catalog_modified: false,
  modification_notice: null,
});

/**
 * What a copy keeps from the catalog workflow it came from, whatever the
 * catalog does now.
 */
export type CatalogCopyLineage = Pick<
  WorkflowCatalogCopy,
  | "catalog_workflow_key"
  | "catalog_version"
  | "license"
  | "attribution"
  | "provenance"
  | "catalog_modified"
>;

/**
 * The read-only catalog fields of a workflow row, and whether its body has
 * changed since the copy; null for a workflow not copied from the catalog.
 */
export function catalogCopyLineage(
  record: WorkflowRecord,
): CatalogCopyLineage | null {
  const key = normalizeOptionalString(record.catalog_workflow_key);
  if (!key) return null;
  const provenance = isRecord(record.provenance)
    ? (record.provenance as unknown as WorkflowProvenance)
    : null;
  const copiedBody =
    typeof provenance?.content_sha256 === "string"
      ? provenance.content_sha256
      : null;
  return {
    catalog_workflow_key: key,
    catalog_version: normalizeOptionalString(record.catalog_version),
    license: (normalizeOptionalString(record.license) ??
      null) as WorkflowLicense | null,
    attribution: normalizeOptionalString(record.attribution),
    provenance,
    catalog_modified:
      copiedBody !== null &&
      copiedBody !==
        workflowBodySha256(record.prompt_md, record.columns_config),
  };
}

/**
 * The read-only catalog fields of a workflow row and its status against the
 * active catalog, which serves `activeVersion` for the row's key (undefined
 * once the key has left the catalog).
 */
export function catalogCopyFields(
  record: WorkflowRecord,
  activeVersion: string | null | undefined,
): WorkflowCatalogCopy {
  const lineage = catalogCopyLineage(record);
  if (!lineage) return { ...NOT_A_CATALOG_COPY };
  return {
    ...lineage,
    catalog_status: catalogStatusFor(lineage.catalog_version, activeVersion),
    catalog_latest_version: activeVersion ?? null,
    modification_notice: lineage.catalog_modified
      ? CATALOG_MODIFICATION_NOTICE
      : null,
  };
}

/**
 * `catalogCopyFields` for one row, looking its key up in the active catalog.
 * The licence, credit and provenance come from the row itself; only the
 * standing against the catalog needs the lookup. A failed lookup must not
 * turn a saved edit or a readable workflow into an error, so it is reported
 * and the status is left unknown (null).
 */
export async function resolveCatalogCopyFields(
  db: Db,
  record: WorkflowRecord,
): Promise<WorkflowCatalogCopy> {
  const key = normalizeOptionalString(record.catalog_workflow_key);
  if (!key) return { ...NOT_A_CATALOG_COPY };
  const versions = await bestEffort(findActiveCatalogVersions(db, [key]), {
    what: "workflow-catalog-status",
  });
  if (!versions) {
    return {
      ...catalogCopyFields(record, null),
      catalog_status: null,
      catalog_latest_version: null,
    };
  }
  return catalogCopyFields(
    record,
    versions.has(key) ? (versions.get(key) ?? null) : undefined,
  );
}

/**
 * The 201 body for a copy just made by an import or a duplicate: the
 * GET /workflows/:id shape, owned by the caller, current by construction.
 */
export function serializeNewCatalogCopy(row: CatalogWorkflowCopy) {
  const record = row as unknown as WorkflowRecord;
  return {
    ...withDatabaseWorkflow(record),
    ...catalogCopyFields(
      record,
      normalizeOptionalString(record.catalog_version),
    ),
    is_owner: true,
    allow_edit: true,
    access_role: "owner" as const,
    // A copy is never one of the installed default workflows.
    is_default: false,
  };
}

// The catalog provenance a copy keeps, key by key as the wire contract
// declares it. A catalog row synced before provenance existed has none, and
// its copies get every key as null rather than a partial object.
const CATALOG_PROVENANCE_KEYS = [
  "catalog_repository",
  "catalog_path",
  "license_file",
  "source_repository",
  "source_path",
  "source_commit",
  "source_name",
  "source_version",
  "review_by",
] as const satisfies ReadonlyArray<keyof WorkflowProvenance>;

// What the copy keeps of the catalog row's provenance, plus what only a copy
// needs: the catalog commit and contributors at the time of the copy, and a
// hash of the body as copied, which is how an edit is recognised later.
function copyProvenance(catalog: Record<string, unknown>): WorkflowProvenance {
  const source = isRecord(catalog.provenance) ? catalog.provenance : {};
  const kept = Object.fromEntries(
    CATALOG_PROVENANCE_KEYS.map((key) => [
      key,
      normalizeOptionalString(source[key]),
    ]),
  ) as Record<(typeof CATALOG_PROVENANCE_KEYS)[number], string | null>;
  return {
    ...kept,
    catalog_commit: normalizeOptionalString(catalog.source_commit),
    contributors: normalizeContributors(catalog.contributors) ?? [],
    content_sha256: workflowBodySha256(
      catalog.prompt_md,
      catalog.columns_config,
    ),
  };
}

/**
 * Copy one catalog row (`select *` of mike_workflows) into the caller's own
 * workflows, with its licence, credit and provenance, and its assistant
 * assets as workflow-asset documents.
 */
export async function copyCatalogWorkflow(
  db: Db,
  params: {
    catalog: Record<string, unknown>;
    userId: string;
    origin: CatalogCopyOrigin;
  },
): Promise<CatalogCopyResult> {
  const { catalog, userId } = params;
  const { data: workflow, error } = await db
    .from("workflows")
    .insert({
      user_id: userId,
      title: catalog.title,
      type: catalog.type,
      prompt_md: catalog.prompt_md,
      columns_config: catalog.columns_config,
      // Catalog rows may omit these; fall back to the workflows
      // column defaults rather than inserting explicit nulls.
      language: catalog.language ?? "English",
      practice: catalog.practice ?? "General Transactions",
      jurisdictions: catalog.jurisdictions ?? ["General"],
      catalog_workflow_key: catalog.workflow_key,
      catalog_version: catalog.version ?? null,
      license: catalog.license ?? null,
      attribution: catalog.attribution ?? null,
      provenance: copyProvenance(catalog),
    })
    .select("*")
    .single();
  if (error || !workflow) {
    return internalFailure(
      error ?? new Error("Workflow catalog copy returned no data"),
    );
  }

  const createdStoragePaths: string[] = [];
  try {
    if (catalog.type === "assistant") {
      await copyCatalogAssets(db, {
        catalogWorkflowId: catalog.id as string,
        workflowId: workflow.id as string,
        userId,
        createdStoragePaths,
      });
    }
  } catch (cause) {
    // Rollback order matters: drop the workflow row first, so nothing can
    // reference the half-made copies (its asset documents go with it), then
    // hand the object deletes to the durable storage.cleanup job, which
    // retries until they are actually gone.
    await db
      .from("workflows")
      .delete()
      .eq("id", workflow.id)
      .eq("user_id", userId);
    await enqueueStorageCleanup(db, createdStoragePaths);
    // The storage or database failure is the cause: its code reaches
    // Sentry as failure_code, where the bare detail string said nothing.
    const reported = ASSET_COPY_FAILURE[params.origin];
    return {
      ok: false,
      kind: "assets_copy_failed",
      detail: reported.detail,
      error: new AppError(reported.kind, reported.message, { cause }),
    };
  }

  return ok(workflow as CatalogWorkflowCopy);
}

// Each catalog asset becomes a workflow-asset document owned by the caller.
// The object is copied server-side by the documents module; catalog assets
// carry no stored PDF, so Word and presentation files get their rendition
// here, as an upload would. Versions are created in one batch, so a copy
// either has every asset or none.
async function copyCatalogAssets(
  db: Db,
  params: {
    catalogWorkflowId: string;
    workflowId: string;
    userId: string;
    createdStoragePaths: string[];
  },
): Promise<void> {
  const { userId, createdStoragePaths } = params;
  const { data, error } = await db
    .from("mike_workflow_assets")
    .select("filename, file_type, storage_path, size_bytes, content_hash")
    .eq("mike_workflow_id", params.catalogWorkflowId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const assets = (data ?? []) as CatalogAssetRow[];
  if (!assets.length) return;

  const plans = assets.map((asset) => {
    const documentId = randomUUID();
    const fileType = (asset.file_type ?? "").toLowerCase();
    return {
      asset,
      fileType,
      documentId,
      versionId: randomUUID(),
      storagePath: storageKey(userId, documentId, asset.filename),
      pdfStoragePath: shouldConvertToPdf(fileType)
        ? convertedPdfKey(userId, documentId)
        : null,
    };
  });

  for (const plan of plans) {
    await copyDocumentVersionFiles({
      source: {
        storage_path: plan.asset.storage_path,
        pdf_storage_path: null,
        file_type: plan.fileType,
      },
      storagePath: plan.storagePath,
      pdfStoragePath: plan.pdfStoragePath ?? plan.storagePath,
      transport: "server",
      rendition: "required",
      beforeWrite: (key) => {
        createdStoragePaths.push(key);
      },
    });
    if (plan.pdfStoragePath) {
      const bytes = await downloadFile(plan.asset.storage_path);
      if (!bytes) {
        throw new Error("A catalog workflow asset is unavailable");
      }
      const display = await prepareDocumentDisplay({
        filename: plan.asset.filename,
        fileType: plan.fileType,
        sourceBytes: bytes,
      });
      createdStoragePaths.push(plan.pdfStoragePath);
      await uploadFile(
        plan.pdfStoragePath,
        display.bytes.buffer.slice(
          display.bytes.byteOffset,
          display.bytes.byteOffset + display.bytes.byteLength,
        ) as ArrayBuffer,
        display.contentType,
      );
    }
  }

  const { error: documentsError } = await db.from("documents").insert(
    plans.map((plan) => ({
      id: plan.documentId,
      workflow_id: params.workflowId,
      user_id: userId,
      status: "processing",
      library_kind: "workflow_asset",
    })),
  );
  if (documentsError) throw documentsError;

  const { error: versionsError } = await createDocumentVersions(
    db,
    plans.map((plan) => ({
      id: plan.versionId,
      document_id: plan.documentId,
      storage_path: plan.storagePath,
      pdf_storage_path: plan.pdfStoragePath,
      source: "upload",
      version_number: 1,
      filename: plan.asset.filename,
      file_type: plan.fileType || null,
      size_bytes: plan.asset.size_bytes,
      content_sha256:
        typeof plan.asset.content_hash === "string" &&
        /^[0-9a-f]{64}$/.test(plan.asset.content_hash)
          ? plan.asset.content_hash
          : null,
    })),
  );
  if (versionsError) throw versionsError;

  const { error: readyError } = await db
    .from("documents")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .in(
      "id",
      plans.map((plan) => plan.documentId),
    );
  if (readyError) throw readyError;
}

/**
 * Make an editable copy of a built-in (`builtin-<key>`) that the active
 * catalog serves. A withdrawn workflow cannot be copied again, and an add-on
 * is copied only through its own import route.
 */
export async function duplicateBuiltInWorkflow(
  db: Db,
  params: { workflowId: string; userId: string },
): Promise<CatalogCopyResult> {
  const workflowKey = catalogKeyFromWorkflowId(params.workflowId);
  if (!workflowKey) return failure("not_found", "Built-in workflow not found");
  const { data: catalog, error } = await db
    .from("mike_workflows")
    .select("*")
    .eq("workflow_key", workflowKey)
    .eq("distribution", "default")
    .eq("active", true)
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!catalog) return failure("not_found", "Built-in workflow not found");
  return copyCatalogWorkflow(db, {
    catalog: catalog as Record<string, unknown>,
    userId: params.userId,
    origin: "builtin",
  });
}
