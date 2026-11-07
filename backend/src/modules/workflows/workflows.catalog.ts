// workflows catalog — implementation behind the module facade.
import type { WorkflowCatalogAttribution } from "@mike/contracts";
import { type Db } from "../../lib/supabase";
import { catalogWorkflowToLegacy, catalogLicensing, ensureDefaultWorkflows, findCatalogWorkflow, listActiveCatalogWorkflows, type LegacyCatalogWorkflow } from "../../lib/workflowCatalog";
import { WorkflowType, ServiceFailure } from "./workflows.types";
import { withSystemWorkflowAccess } from "./workflows.serialization";

// The built-in workflows now live in the `mike_workflows` catalog table
// rather than a compiled-in constant, so the lookup is a query and the
// catalog row is projected back into the legacy system-workflow shape.
export async function findSystemWorkflow(
  db: Db,
  workflowId: string,
): Promise<LegacyCatalogWorkflow | null> {
  const catalogWorkflow = await findCatalogWorkflow(workflowId, db);
  return catalogWorkflow ? catalogWorkflowToLegacy(catalogWorkflow) : null;
}

// Retained as a compatibility listing for older clients. The restructured
// Workflows page no longer exposes a System tab; non-default catalog entries
// are presented through /workflow-addons instead.
export async function listSystemWorkflows(
  db: Db,
  workflowType: WorkflowType | null,
) {
  const catalog = await listActiveCatalogWorkflows(db, { type: workflowType });
  return catalog.map(catalogWorkflowToLegacy).map(withSystemWorkflowAccess);
}

// Every workflow in the active catalog — built-ins and importable add-ons
// alike — with just the credit, licence, source and revision the open-source
// notices page (GET /workflows/attributions) renders. Ordered by pack then
// title so the page can group without a second pass. Licence fields are null
// on rows synced before provenance existed; the page says so in plain words.
export async function listCatalogAttributions(
  db: Db,
): Promise<WorkflowCatalogAttribution[]> {
  const catalog = await listActiveCatalogWorkflows(db);
  return catalog
    .map((workflow): WorkflowCatalogAttribution => {
      const licensing = catalogLicensing(workflow);
      return {
        workflow_key: workflow.workflow_key,
        title: workflow.title,
        type: workflow.type,
        distribution: workflow.distribution,
        pack_key: workflow.pack_key,
        pack_title: workflow.pack_title,
        version: workflow.version,
        contributors: workflow.contributors ?? [],
        license: licensing.license,
        license_evidence: licensing.license_evidence,
        attribution: licensing.attribution,
        provenance: licensing.provenance,
        source_commit: licensing.source_commit,
      };
    })
    .sort((a, b) => {
      const pack = (a.pack_title ?? "").localeCompare(b.pack_title ?? "");
      return pack !== 0 ? pack : a.title.localeCompare(b.title);
    });
}

export async function markDefaultWorkflows<T extends { id: string }>(
  db: Db,
  userId: string,
  workflows: T[],
): Promise<Array<T & { is_default: boolean; default_key: string | null }>> {
  if (workflows.length === 0) return [];
  const { data, error } = await db
    .from("default_workflow_installations")
    .select("workflow_id, default_key")
    .eq("user_id", userId)
    .in(
      "workflow_id",
      workflows.map((workflow) => workflow.id),
    );
  if (error) throw error;
  const defaultKeyByWorkflowId = new Map(
    (data ?? []).flatMap((row) =>
      row.workflow_id && row.default_key
        ? [[row.workflow_id, row.default_key] as const]
        : [],
    ),
  );
  return workflows.map((workflow) => ({
    ...workflow,
    is_default: defaultKeyByWorkflowId.has(workflow.id),
    default_key: defaultKeyByWorkflowId.get(workflow.id) ?? null,
  }));
}

// Installs any missing default catalog workflows for the user (cached
// per-process inside ensureDefaultWorkflows, so repeat calls are cheap).
// The raw error is handed back so the route can log it and answer with the
// opaque internal-error body instead of leaking the driver's message.
export async function ensureDefaultsInstalled(
  db: Db,
  userId: string,
): Promise<ServiceFailure | { ok: true }> {
  try {
    await ensureDefaultWorkflows(userId, db);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
