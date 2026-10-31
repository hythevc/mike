import type {
  WorkflowCatalogLicensing,
  WorkflowLicense,
  WorkflowLicenseEvidence,
  WorkflowProvenance,
} from "@mike/contracts";
import { chunkArray } from "./arrays";
import type { Db } from "./supabase";

export type WorkflowCatalogContributor = {
  name: string;
  organisation: string | null;
  role: string | null;
  linkedin: string | null;
};

export type WorkflowCatalogColumn = {
  index: number;
  name: string;
  format?: string;
  prompt: string;
  tags?: string[];
};

export type WorkflowCatalogRow = {
  id: string;
  workflow_key: string;
  distribution: "default" | "addon";
  version: string | null;
  title: string;
  description: string | null;
  type: "assistant" | "tabular";
  prompt_md: string | null;
  columns_config: WorkflowCatalogColumn[] | null;
  contributors: WorkflowCatalogContributor[] | null;
  language: string | null;
  practice: string | null;
  jurisdictions: string[] | null;
  pack_key: string | null;
  pack_title: string | null;
  pack_description: string | null;
  pack_version: string | null;
  // Licence and provenance (20261031_52_workflow_provenance.sql). Null on
  // rows synced before that migration; the sync writes only accepted values.
  license?: WorkflowLicense | null;
  license_evidence?: WorkflowLicenseEvidence | null;
  author_confirmation?: string | null;
  attribution?: string | null;
  provenance?: WorkflowProvenance | null;
  notice_md?: string | null;
  changes_md?: string | null;
  source_commit: string | null;
  content_hash: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

// The built-in detail (GET /workflows/builtin-<key>): the legacy system
// workflow shape plus the catalog's licence, credit and notices as the wire
// contract declares them.
export type LegacyCatalogWorkflow = WorkflowCatalogLicensing & {
  id: string;
  user_id: null;
  is_system: true;
  created_at: string;
  metadata: {
    name: string;
    title: string;
    description: string;
    type: "assistant" | "tabular";
    contributors: WorkflowCatalogContributor[];
    language: string;
    version: string;
    practice: string | null;
    jurisdictions: string[] | null;
  };
  skill_md: string | null;
  columns_config: WorkflowCatalogColumn[] | null;
  assets: [];
  pack: {
    key: string;
    title: string;
    description: string;
    version: string;
  } | null;
};

/**
 * A catalog row's licence, credit, notices and source commit in the wire
 * shape, each null on a row synced before the field existed.
 */
export function catalogLicensing(
  workflow: WorkflowCatalogRow,
): WorkflowCatalogLicensing {
  return {
    license: workflow.license ?? null,
    license_evidence: workflow.license_evidence ?? null,
    author_confirmation: workflow.author_confirmation ?? null,
    attribution: workflow.attribution ?? null,
    provenance: workflow.provenance ?? null,
    notice_md: workflow.notice_md ?? null,
    changes_md: workflow.changes_md ?? null,
    source_commit: workflow.source_commit ?? null,
  };
}

export function catalogWorkflowId(workflowKey: string): string {
  return `builtin-${workflowKey}`;
}

export function catalogKeyFromWorkflowId(workflowId: string): string | null {
  const match = workflowId.match(/^builtin-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  return match?.[1] ?? null;
}

export function catalogWorkflowToLegacy(
  workflow: WorkflowCatalogRow,
): LegacyCatalogWorkflow {
  return {
    id: catalogWorkflowId(workflow.workflow_key),
    user_id: null,
    is_system: true,
    created_at: workflow.created_at,
    metadata: {
      name: workflow.workflow_key,
      title: workflow.title,
      description: workflow.description ?? "",
      type: workflow.type,
      contributors: workflow.contributors ?? [],
      language: workflow.language ?? "English",
      version: workflow.version ?? "",
      practice: workflow.practice,
      jurisdictions: workflow.jurisdictions,
    },
    skill_md: workflow.prompt_md,
    columns_config: workflow.columns_config,
    // Asset bytes live in object storage. The compatibility endpoint has
    // never been the import path; current clients use /workflow-addons.
    assets: [],
    pack: workflow.pack_key
      ? {
          key: workflow.pack_key,
          title: workflow.pack_title ?? workflow.pack_key,
          description: workflow.pack_description ?? "",
          version: workflow.pack_version ?? "",
        }
      : null,
    ...catalogLicensing(workflow),
  };
}

export async function findCatalogWorkflow(
  workflowId: string,
  db: Db,
): Promise<WorkflowCatalogRow | null> {
  const workflowKey = catalogKeyFromWorkflowId(workflowId);
  if (!workflowKey) return null;
  const { data, error } = await db
    .from("mike_workflows")
    .select("*")
    .eq("workflow_key", workflowKey)
    .order("active", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkflowCatalogRow | null) ?? null;
}

export async function listActiveCatalogWorkflows(
  db: Db,
  filters: {
    type?: "assistant" | "tabular" | null;
    distribution?: "default" | "addon" | null;
  } = {},
): Promise<WorkflowCatalogRow[]> {
  let query = db.from("mike_workflows").select("*").eq("active", true);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.distribution) {
    query = query.eq("distribution", filters.distribution);
  }
  const { data, error } = await query.order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WorkflowCatalogRow[];
}

// Keys travel in the query string, as in the add-on asset lookup.
const ACTIVE_VERSION_LOOKUP_BATCH_SIZE = 50;

/**
 * The version the active catalog serves for each of `workflowKeys`. A key
 * missing from the result is no longer in the catalog (withdrawn).
 */
export async function findActiveCatalogVersions(
  db: Db,
  workflowKeys: string[],
): Promise<Map<string, string | null>> {
  const keys = [...new Set(workflowKeys)].filter((key) =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key),
  );
  const versions = new Map<string, string | null>();
  for (const batch of chunkArray(keys, ACTIVE_VERSION_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await db
      .from("mike_workflows")
      .select("workflow_key, version")
      .eq("active", true)
      .in("workflow_key", batch);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      workflow_key: string;
      version: string | null;
    }>) {
      versions.set(row.workflow_key, row.version ?? null);
    }
  }
  return versions;
}

// Installation markers make the database function a no-op after a user's
// first successful install. The process-local cache avoids even that RPC on
// each workflow list, Quick Action list, and chat message.
const ensuredDefaultUsers = new Set<string>();

export function resetEnsuredDefaultUsersForTests(): void {
  ensuredDefaultUsers.clear();
}

export async function ensureDefaultWorkflows(
  userId: string,
  db: Db,
): Promise<number> {
  if (ensuredDefaultUsers.has(userId)) return 0;
  const { data, error } = await db.rpc("install_missing_default_workflows", {
    p_user_id: userId,
  });
  if (error) throw error;
  ensuredDefaultUsers.add(userId);
  return typeof data === "number" ? data : 0;
}
