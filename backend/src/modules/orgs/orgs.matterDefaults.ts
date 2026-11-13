// SPDX-License-Identifier: AGPL-3.0-only
//
// What an organization's new matters start with: default jurisdictions and a
// default working language (organizations.default_jurisdictions and
// default_working_language).
//
// Any member may read them, since they describe what a matter that member
// creates will start with. Setting them is day-to-day administration, so it
// takes an owner or an admin, like renaming the organization. The values are
// validated against the jurisdiction registry and the response-language list
// by lib/jurisdictionProfile.ts, the same rules a matter's own profile uses.
// A matter copies the defaults when it is created (see the projects module);
// changing them later does not touch existing matters.

import type { OrgMatterDefaults } from "@mike/contracts";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import {
    orgMatterDefaultsOf,
    parseOrgMatterDefaultFields,
} from "../../lib/jurisdictionProfile";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

// The sentences lib/orgFailure.ts sends for the same refusals, so these
// routes answer like every other organization route.
const ORG_NOT_FOUND = "Organization not found";
const ORG_ADMIN_ONLY = "Only an organization admin can do that.";

const DEFAULT_COLUMNS = "default_jurisdictions, default_working_language";

/** The organization's matter defaults, for any of its members. */
export async function getOrgMatterDefaults(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<ServiceResult<OrgMatterDefaults>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return failure("not_found", ORG_NOT_FOUND);

    const { data, error } = await db
        .from("organizations")
        .select(DEFAULT_COLUMNS)
        .eq("id", params.orgId)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", ORG_NOT_FOUND);
    return ok(orgMatterDefaultsOf(data));
}

/**
 * Set the organization's matter defaults. Owners and admins only. Only the
 * fields the body carries change; `null` clears one. The caller's standing is
 * decided before the body is read, so somebody outside the organization
 * learns nothing from how their request was refused.
 */
export async function setOrgMatterDefaults(
    db: Db,
    params: {
        actorId: string;
        actorEmail?: string | null;
        orgId: string;
        body: unknown;
    },
): Promise<ServiceResult<OrgMatterDefaults>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return failure("not_found", ORG_NOT_FOUND);
    if (!isOrgAdmin(role)) return failure("forbidden", ORG_ADMIN_ONLY);

    const body =
        params.body !== null &&
        typeof params.body === "object" &&
        !Array.isArray(params.body)
            ? (params.body as Record<string, unknown>)
            : {};
    const parsed = parseOrgMatterDefaultFields(body);
    if (!parsed.ok) return failure("validation", parsed.detail, parsed.code);

    const { data: before, error: readError } = await db
        .from("organizations")
        .select(DEFAULT_COLUMNS)
        .eq("id", params.orgId)
        .maybeSingle();
    if (readError) return internalFailure(readError);
    if (!before) return failure("not_found", ORG_NOT_FOUND);
    const previous = orgMatterDefaultsOf(before);

    const fields = parsed.fields;
    const changed = (
        Object.keys(fields) as (keyof OrgMatterDefaults)[]
    ).filter(
        (field) =>
            JSON.stringify(fields[field]) !== JSON.stringify(previous[field]),
    );
    // Nothing to write: a request that repeats what is stored is answered
    // with it, and leaves no audit row behind.
    if (changed.length === 0) return ok(previous);

    const { data, error } = await db
        .from("organizations")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", params.orgId)
        .select(DEFAULT_COLUMNS);
    if (error) return internalFailure(error);
    const saved = (data as Record<string, unknown>[] | null)?.[0];
    if (!saved) return failure("not_found", ORG_NOT_FOUND);
    const defaults = orgMatterDefaultsOf(saved);

    // One event saying which defaults changed and what they are now. The
    // values are registry codes and a language tag.
    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        orgId: params.orgId,
        action: "org.matter_defaults.updated",
        surface: "organization",
        detail: {
            changed,
            ...Object.fromEntries(
                changed.map((field) => [field, defaults[field]]),
            ),
        },
    });
    return ok(defaults);
}
