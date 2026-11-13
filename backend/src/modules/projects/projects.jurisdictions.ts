// SPDX-License-Identifier: AGPL-3.0-only
//
// The matter jurisdiction profile inside the projects module: the registry
// the pickers are served, the profile on project list rows, the organization
// defaults a new matter starts with, and the audit row a change writes.
//
// What a valid value is, and the codes a refusal carries, live in
// lib/jurisdictionProfile.ts, which the orgs module and the chat engine
// share.

import type { JurisdictionRegistry } from "@mike/contracts";
import { chunkArray } from "../../lib/arrays";
import { recordAudit } from "../../lib/audit";
import { listLaunchJurisdictions } from "../../lib/jurisdictions";
import {
    MAX_PROFILE_JURISDICTIONS,
    currentMatterJurisdictionProfile,
    matterJurisdictionProfileOf,
    orgMatterDefaultsOf,
    type MatterJurisdictionProfile,
} from "../../lib/jurisdictionProfile";
import { RESPONSE_LANGUAGES } from "../../lib/responseLanguages";
import type { Db } from "./projects.shared";

/**
 * GET /projects/jurisdictions: what the jurisdiction, governing-law and
 * working-language pickers offer. The same for every caller.
 */
export function getJurisdictionRegistry(): JurisdictionRegistry {
    return {
        jurisdictions: listLaunchJurisdictions().map((jurisdiction) => ({
            code: jurisdiction.code,
            name: jurisdiction.name,
            kind: jurisdiction.kind,
            parent: jurisdiction.parent,
            languages: [...jurisdiction.languages],
        })),
        working_languages: Object.entries(RESPONSE_LANGUAGES).map(
            ([code, name]) => ({ code, name }),
        ),
        max_jurisdictions: MAX_PROFILE_JURISDICTIONS,
    };
}

// Ids are spliced into the request line, which a gateway caps; a firm's
// project list can be long, so the read is paged.
const PROFILE_READ_BATCH = 100;

/**
 * Adds each project's jurisdiction profile to rows that came from a list
 * function, which returns a fixed set of columns. One read per hundred
 * projects, never one per row. A failed read is reported to the caller: an
 * empty profile must not stand in for one that did not load.
 */
export async function attachMatterJurisdictionProfiles<
    T extends { id: string },
>(
    db: Db,
    projects: T[],
): Promise<{
    rows: (T & MatterJurisdictionProfile)[];
    error: unknown | null;
}> {
    const profiles = new Map<string, MatterJurisdictionProfile>();
    for (const ids of chunkArray(
        projects.map((project) => project.id),
        PROFILE_READ_BATCH,
    )) {
        const { data, error } = await db
            .from("projects")
            .select("id, jurisdictions, governing_law, working_language")
            .in("id", ids);
        if (error)
            return {
                rows: projects.map((project) => withMatterJurisdictionProfile(project)),
                error,
            };
        for (const row of (data ?? []) as { id?: unknown }[])
            if (typeof row.id === "string")
                profiles.set(row.id, matterJurisdictionProfileOf(row));
    }
    return {
        rows: projects.map((project) => ({
            ...project,
            ...(profiles.get(project.id) ?? matterJurisdictionProfileOf(null)),
        })),
        error: null,
    };
}

/**
 * A row that already carries the profile columns (a `select *` of projects),
 * with the three fields in their stable shape.
 */
export function withMatterJurisdictionProfile<T extends object>(
    row: T,
): T & MatterJurisdictionProfile {
    return { ...row, ...matterJurisdictionProfileOf(row) };
}

/**
 * What a new matter in `orgId` starts with when the request does not say:
 * the organization's default jurisdictions and working language, kept only
 * where they are still valid. There is no default governing law.
 *
 * Never fails a creation: the defaults are a convenience, so an unreadable
 * organization row means the matter starts with nothing recorded.
 */
export async function loadNewMatterDefaults(
    db: Db,
    orgId: string,
): Promise<Pick<MatterJurisdictionProfile, "jurisdictions" | "working_language">> {
    const nothing = { jurisdictions: [], working_language: null };
    try {
        const { data, error } = await db
            .from("organizations")
            .select("default_jurisdictions, default_working_language")
            .eq("id", orgId)
            .maybeSingle();
        if (error || !data) return nothing;
        const defaults = orgMatterDefaultsOf(data);
        const current = currentMatterJurisdictionProfile({
            jurisdictions: defaults.default_jurisdictions,
            governing_law: null,
            working_language: defaults.default_working_language,
        });
        return {
            jurisdictions: current.jurisdictions,
            working_language: current.working_language,
        };
    } catch {
        return nothing;
    }
}

const PROFILE_FIELDS = [
    "jurisdictions",
    "governing_law",
    "working_language",
] as const;

/** The fields of `next` whose value differs from `before`. */
export function changedProfileFields(
    before: MatterJurisdictionProfile,
    next: Partial<MatterJurisdictionProfile>,
): (typeof PROFILE_FIELDS)[number][] {
    return PROFILE_FIELDS.filter((field) => {
        if (!(field in next) || next[field] === undefined) return false;
        return JSON.stringify(next[field]) !== JSON.stringify(before[field]);
    });
}

/**
 * One audit row for a change to a matter's jurisdiction profile: who changed
 * it, on which matter, which fields, and what they are now. The values are
 * registry codes and a language tag, so nothing about the client is written.
 */
export async function recordMatterProfileChange(
    db: Db,
    args: {
        userId: string;
        userEmail?: string | null;
        orgId: string | null;
        projectId: string;
        changed: readonly (typeof PROFILE_FIELDS)[number][];
        profile: MatterJurisdictionProfile;
    },
): Promise<void> {
    if (args.changed.length === 0) return;
    await recordAudit(db, {
        userId: args.userId,
        orgId: args.orgId,
        userEmail: args.userEmail ?? null,
        action: "project.jurisdiction_profile.updated",
        surface: "project",
        projectId: args.projectId,
        detail: {
            changed: [...args.changed],
            ...Object.fromEntries(
                args.changed.map((field) => [field, args.profile[field]]),
            ),
        },
    });
}
