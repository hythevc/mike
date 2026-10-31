// Business logic + data access for the workflow ADD-ON CATALOG — the
// read-only `mike_workflows` rows (distribution = "addon") a user can browse
// and import into their own `workflows` table.
//
// This is a topic file of the workflows module: it takes an explicit `Db`,
// returns typed `ServiceResult`s, and never imports express or touches
// req/res. The thin handlers in workflowAddons.routes.ts map the results onto
// status codes. Its functions are re-exported by name from
// workflows.service.ts, the module facade.

import type { Db } from "../../lib/supabase";
import { chunkArray } from "../../lib/arrays";
import {
  loadDocumentDisplay,
  type DocumentDisplayPayload,
} from "../../lib/documentDisplay";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import {
  copyCatalogWorkflow,
  type CatalogCopyFailure,
  type CatalogCopyResult,
  type CatalogWorkflowCopy,
} from "./workflows.catalogCopy";

// The catalog columns the list endpoint projects. Kept as one string so the
// select list stays byte-identical to the pre-move query.
const ADDON_LIST_COLUMNS =
  "id, workflow_key, pack_key, pack_title, pack_description, pack_version, version, title, description, type, contributors, language, practice, jurisdictions, active, updated_at";

// PostgREST filters travel in the query string (and PostgREST echoes them back
// in Content-Location), so an unbounded `in.(...)` list grows with the catalog
// until a proxy rejects the request or response. 50 UUIDs keep it under ~2 KB.
const ASSET_LOOKUP_BATCH_SIZE = 50;

type AddonAssetRow = {
  id: string;
  mike_workflow_id: string;
  filename: string;
  file_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** A catalog row as sent to the client: `workflow_key` renamed to `addon_key`. */
export type WorkflowAddonSummary = Record<string, unknown>;

/**
 * List the active add-on catalog, optionally narrowed to one workflow type,
 * with each assistant add-on's assets attached.
 */
export async function listWorkflowAddons(
  db: Db,
  params: { type: string | null },
): Promise<ServiceResult<WorkflowAddonSummary[]>> {
  let query = db
    .from("mike_workflows")
    .select(ADDON_LIST_COLUMNS)
    .eq("distribution", "addon")
    .eq("active", true);
  if (params.type === "assistant" || params.type === "tabular")
    query = query.eq("type", params.type);
  const { data, error } = await query.order("title", { ascending: true });
  if (error) return internalFailure(error);
  const addons = (data ?? []) as Record<string, unknown>[];
  const assistantIds = addons
    .filter((addon) => addon.type === "assistant")
    .map((addon) => addon.id as string);
  // Each add-on's assets land in exactly one batch, so per-batch ordering by
  // created_at is enough to keep every add-on's asset list ordered.
  const assets: AddonAssetRow[] = [];
  for (const batch of chunkArray(assistantIds, ASSET_LOOKUP_BATCH_SIZE)) {
    const { data, error: assetsError } = await db
      .from("mike_workflow_assets")
      .select("id, mike_workflow_id, filename, file_type, size_bytes, created_at")
      .in("mike_workflow_id", batch)
      .order("created_at", { ascending: true });
    if (assetsError) return internalFailure(assetsError);
    assets.push(...((data ?? []) as AddonAssetRow[]));
  }
  const assetsByAddon = new Map<string, AddonAssetRow[]>();
  for (const asset of assets) {
    const current = assetsByAddon.get(asset.mike_workflow_id) ?? [];
    current.push(asset);
    assetsByAddon.set(asset.mike_workflow_id, current);
  }
  return ok(
    addons.map(({ workflow_key, ...addon }) => ({
      ...addon,
      addon_key: workflow_key,
      assets: (assetsByAddon.get(addon.id as string) ?? []).map(
        ({ mike_workflow_id: _workflowId, ...asset }) => asset,
      ),
    })),
  );
}

/**
 * Resolve the display bytes for one asset of an assistant add-on. The caller
 * streams the payload; a missing add-on, asset, or object is a 404.
 */
export async function loadWorkflowAddonAssetDisplay(
  db: Db,
  params: { addonId: string; assetId: string },
): Promise<ServiceResult<DocumentDisplayPayload>> {
  const { data: addon, error: addonError } = await db
    .from("mike_workflows")
    .select("id, type")
    .eq("id", params.addonId)
    .eq("distribution", "addon")
    .eq("active", true)
    .maybeSingle();
  if (addonError) return internalFailure(addonError);
  if (!addon || addon.type !== "assistant") {
    return failure("not_found", "Add-on not found");
  }

  const { data: asset, error: assetError } = await db
    .from("mike_workflow_assets")
    .select("id, filename, file_type, storage_path")
    .eq("id", params.assetId)
    .eq("mike_workflow_id", addon.id)
    .maybeSingle();
  if (assetError) return internalFailure(assetError);
  if (!asset) {
    return failure("not_found", "Asset not found");
  }

  try {
    const display = await loadDocumentDisplay({
      filename: asset.filename,
      fileType: asset.file_type,
      storagePath: asset.storage_path,
    });
    if (!display) {
      return failure("not_found", "Asset not found in storage");
    }
    return ok(display);
  } catch (error) {
    return internalFailure(error);
  }
}

/** One catalog row in full, with its assistant assets attached. */
export async function getWorkflowAddon(
  db: Db,
  params: { addonId: string },
): Promise<ServiceResult<Record<string, unknown>>> {
  const { data, error } = await db
    .from("mike_workflows")
    .select("*")
    .eq("id", params.addonId)
    .eq("distribution", "addon")
    .eq("active", true)
    .maybeSingle();
  if (error || !data) {
    return failure("not_found", "Add-on not found");
  }
  let assets = null;
  if (data.type === "assistant") {
    const { data: assistantAssets, error: assetsError } = await db
      .from("mike_workflow_assets")
      .select("id, filename, file_type, size_bytes, created_at")
      .eq("mike_workflow_id", data.id)
      .order("created_at", { ascending: true });
    if (assetsError) {
      return internalFailure(assetsError);
    }
    assets = assistantAssets;
  }
  const { workflow_key, ...addon } = data;
  return ok({
    ...addon,
    addon_key: workflow_key,
    assets: assets ?? [],
  });
}

/** The workflow payload returned to the client after a successful import. */
// The freshly inserted `workflows` row, handed back RAW. Serializing it is the
// route's job, through serializeNewCatalogCopy, which builds on the same
// withDatabaseWorkflow the workflows facade uses for GET /workflows/:id —
// rebuilding the shape here is what let it drift.
export type ImportedWorkflow = CatalogWorkflowCopy;

// Copying the add-on's assets can fail after the workflow row exists; that
// failure answers 500 with its own detail (see workflows.catalogCopy.ts).
export type WorkflowAddonImportFailure = CatalogCopyFailure;

export type ImportWorkflowAddonResult = CatalogCopyResult;

/**
 * Copy a catalog add-on into the caller's own workflows, with its licence,
 * credit and provenance, duplicating any assistant assets into their
 * document library.
 */
export async function importWorkflowAddon(
  db: Db,
  params: { addonId: string; userId: string },
): Promise<ImportWorkflowAddonResult> {
  const { data: addon, error: addonError } = await db
    .from("mike_workflows")
    .select("*")
    .eq("id", params.addonId)
    .eq("distribution", "addon")
    .eq("active", true)
    .maybeSingle();
  // A failed lookup is not the same as a missing add-on; reporting 404 for both
  // told the user to stop retrying a request that might well succeed.
  if (addonError) return internalFailure(addonError);
  if (!addon) return failure("not_found", "Add-on not found");
  return copyCatalogWorkflow(db, {
    catalog: addon as Record<string, unknown>,
    userId: params.userId,
    origin: "addon",
  });
}
