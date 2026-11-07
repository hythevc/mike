// SPDX-License-Identifier: AGPL-3.0-only
//
// The words the workflow attribution UI uses — the catalog-status notice, the
// read-only credit block, the add-on preview's licence rows and the
// open-source notices page — gathered here so they can be reviewed together.
// Statuses read as plain text, never pill badges, as AGENTS.md asks.

import type {
  WorkflowAddon,
  WorkflowCatalogAttribution,
  WorkflowCatalogStatus,
  WorkflowLicense,
  WorkflowLicenseEvidence,
  WorkflowProvenance,
  Workflow,
} from "@/app/components/shared/types";

/** Plain-text standing of a catalog copy against the catalog it came from. */
export const CATALOG_STATUS_LABEL: Record<WorkflowCatalogStatus, string> = {
  current: "Up to date with the catalog",
  update_available: "Update available",
  withdrawn: "Withdrawn from the catalog",
};

/**
 * The status worth telling the reader about: an available update or a
 * withdrawal. A copy that matches the catalog needs no notice.
 */
export function catalogStatusNotice(
  status: WorkflowCatalogStatus | null | undefined,
): string | null {
  if (status === "update_available") return CATALOG_STATUS_LABEL.update_available;
  if (status === "withdrawn") return CATALOG_STATUS_LABEL.withdrawn;
  return null;
}

/** Shown beside the credit once a copy's instructions or columns change. */
export const MODIFICATION_NOTICE = "Modified by your organisation";

/** The attribution UI's fixed words, in one place for review. */
export const ATTRIBUTION_TEXT = {
  creditsHeading: "Credits and licence",
  licence: "Licence",
  adaptedFrom: "Adapted from",
  source: "Source",
  changes: "Changes",
  notice: "Notice",
  viewSource: "View source at this revision",
  viewChanges: "View changes",
  licenceNotRecorded: "Licence not recorded",
  authorConfirmationPending: "Licence confirmed by the author: pending",
  noticesHeading: "Open-source notices",
  noticesIntro:
    "The workflows in the active catalog, with the author credited, the licence that governs each one, and a link to its source at the revision in use.",
  noticesEmpty: "No workflows are in the active catalog yet.",
  noticesError: "The open-source notices could not be loaded.",
  revision: "Revision",
  builtIn: "Built-in",
  addOn: "Add-on",
} as const;

const SPDX_LICENSE_URL: Record<WorkflowLicense, string> = {
  "AGPL-3.0-only": "https://spdx.org/licenses/AGPL-3.0-only.html",
  "AGPL-3.0-or-later": "https://spdx.org/licenses/AGPL-3.0-or-later.html",
  "Apache-2.0": "https://spdx.org/licenses/Apache-2.0.html",
  "CC-BY-4.0": "https://spdx.org/licenses/CC-BY-4.0.html",
  MIT: "https://spdx.org/licenses/MIT.html",
};

/** The SPDX licence page for a workflow's licence; null when unrecorded. */
export function licenseUrl(
  license: WorkflowLicense | null | undefined,
): string | null {
  return license ? SPDX_LICENSE_URL[license] : null;
}

/** "Apache-2.0 (licence declared by the author)" vs the plain SPDX id. */
export function licenseLabel(
  license: WorkflowLicense | null | undefined,
  evidence: WorkflowLicenseEvidence | null | undefined,
): string {
  if (!license) return ATTRIBUTION_TEXT.licenceNotRecorded;
  return evidence === "manifest-only"
    ? `${license} (licence declared by the author)`
    : license;
}

// A catalog repository reaches the web either as a full URL or as the
// "owner/name" GitHub shorthand the catalog records. Anything else yields no
// link rather than a guessed one.
function repositoryBaseUrl(repository: string | null | undefined): string | null {
  if (!repository) return null;
  if (/^https?:\/\//i.test(repository)) return repository.replace(/\/+$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return `https://github.com/${repository}`;
  }
  return null;
}

function joinPath(base: string, ...segments: Array<string | null | undefined>) {
  const tail = segments
    .filter((segment): segment is string => !!segment)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return tail ? `${base}/${tail}` : base;
}

/**
 * A link to the catalog tree holding the workflow at `commit` — the AGPL
 * s.13 offer of Corresponding Source. Null when the catalog records no
 * linkable repository or no commit.
 */
export function catalogSourceUrl(
  provenance: WorkflowProvenance | null | undefined,
  commit: string | null | undefined,
): string | null {
  const base = repositoryBaseUrl(provenance?.catalog_repository);
  if (!base || !commit) return null;
  return joinPath(base, "tree", commit, provenance?.catalog_path);
}

/** A link to the workflow's CHANGES.md at `commit`; null when not linkable. */
export function catalogChangesUrl(
  provenance: WorkflowProvenance | null | undefined,
  commit: string | null | undefined,
): string | null {
  const base = repositoryBaseUrl(provenance?.catalog_repository);
  if (!base || !commit) return null;
  return joinPath(base, "blob", commit, provenance?.catalog_path, "CHANGES.md");
}

/** The upstream work a workflow was adapted from, by name; null when none. */
export function adaptedFromTitle(
  provenance: WorkflowProvenance | null | undefined,
): string | null {
  return provenance?.source_name?.trim() || null;
}

/** A short revision label: the version, or the short commit, or null. */
export function revisionLabel(
  version: string | null | undefined,
  commit: string | null | undefined,
): string | null {
  if (version?.trim()) return version.trim();
  if (commit?.trim()) return commit.trim().slice(0, 12);
  return null;
}

/**
 * The common shape the credit block, the preview rows and the credits panel
 * render, drawn from whichever payload a surface has: a workflow detail, an
 * add-on detail, or a notices-page entry.
 */
export interface WorkflowAttributionInfo {
  license: WorkflowLicense | null;
  licenseEvidence: WorkflowLicenseEvidence | null;
  attribution: string | null;
  /** The upstream work's title, from provenance.source_name. */
  adaptedFromTitle: string | null;
  provenance: WorkflowProvenance | null;
  /** The NOTICE text, verbatim, when the source had one. */
  noticeMd: string | null;
  /** The change log (CHANGES.md), when the payload carries it (built-ins). */
  changesMd: string | null;
  /** The commit the source and changes links point at. */
  commit: string | null;
  status: WorkflowCatalogStatus | null;
  /** "Modified by your organisation" once a copy is modified. */
  modificationNotice: string | null;
}

/** Whether there is any credit, licence or source worth showing. */
export function hasWorkflowAttribution(
  info: WorkflowAttributionInfo,
): boolean {
  return !!(
    info.license ||
    info.attribution ||
    info.adaptedFromTitle ||
    catalogSourceUrl(info.provenance, info.commit)
  );
}

/** The attribution a workflow detail payload carries (a copy or a built-in). */
export function attributionInfoFromWorkflow(
  workflow: Workflow,
): WorkflowAttributionInfo {
  return {
    license: workflow.license ?? null,
    licenseEvidence: workflow.license_evidence ?? null,
    attribution: workflow.attribution ?? null,
    adaptedFromTitle: adaptedFromTitle(workflow.provenance),
    provenance: workflow.provenance ?? null,
    noticeMd: workflow.notice_md ?? null,
    changesMd: workflow.changes_md ?? null,
    // A built-in links at the catalog commit it was synced from; an editable
    // copy links at the commit it was made from.
    commit:
      workflow.provenance?.catalog_commit ?? workflow.source_commit ?? null,
    status: workflow.catalog_status ?? null,
    modificationNotice: workflow.modification_notice ?? null,
  };
}

/** The attribution an add-on detail payload carries. */
export function attributionInfoFromAddon(
  addon: WorkflowAddon,
): WorkflowAttributionInfo {
  return {
    license: addon.license ?? null,
    licenseEvidence: addon.license_evidence ?? null,
    attribution: addon.attribution ?? null,
    adaptedFromTitle: adaptedFromTitle(addon.provenance),
    provenance: addon.provenance ?? null,
    noticeMd: addon.notice_md ?? null,
    changesMd: addon.changes_md ?? null,
    commit: addon.provenance?.catalog_commit ?? addon.source_commit ?? null,
    status: null,
    modificationNotice: null,
  };
}

/** The attribution a notices-page entry carries. */
export function attributionInfoFromCatalogEntry(
  entry: WorkflowCatalogAttribution,
): WorkflowAttributionInfo {
  return {
    license: entry.license,
    licenseEvidence: entry.license_evidence,
    attribution: entry.attribution,
    adaptedFromTitle: adaptedFromTitle(entry.provenance),
    provenance: entry.provenance,
    noticeMd: null,
    changesMd: null,
    commit: entry.provenance?.catalog_commit ?? entry.source_commit ?? null,
    status: null,
    modificationNotice: null,
  };
}
