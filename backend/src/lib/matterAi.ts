// SPDX-License-Identifier: AGPL-3.0-only
//
// Matter-level AI restriction (W18).
//
// A firm can switch AI off for a matter (project) whose client has restricted
// its use. Before any provider call on a restricted matter's documents, the
// entry points that start model work refuse with `matter_ai_restricted`, so no
// document of that matter reaches a model. The restriction is a property of the
// matter (`projects.ai_restricted`); a project chat, a tabular review, a
// playbook run or an assistant/Word turn inherits it from the matter its
// documents belong to.
//
// Two shapes, for the two kinds of caller:
//   - `assertMatterAllowsAi` throws `MatterAiRestrictedError`, for callers that
//     let a thrown error propagate (the playbook review gate).
//   - `isMatterAiRestricted` / `restrictedMatterAmongDocuments` are predicates,
//     for the pre-stream preparers that return a typed error instead of
//     throwing (project chat, assistant chat, Word chat, tabular generate).

import type { Db } from "./supabase";
import { UserFacingError } from "./userFacingError";

export const MATTER_AI_RESTRICTED_CODE = "matter_ai_restricted";

export const MATTER_AI_RESTRICTED_DETAIL =
    "AI is switched off for this matter at the client's request. A project owner or editor can turn it back on from the project menu.";

/**
 * A model call was refused because its matter has AI switched off. Written for
 * the user: the chat surfaces show it as it is, and HTTP routes answer 403 with
 * its code.
 */
export class MatterAiRestrictedError extends UserFacingError {
    readonly code = MATTER_AI_RESTRICTED_CODE;

    constructor(readonly projectId: string | null = null) {
        super(MATTER_AI_RESTRICTED_DETAIL);
        this.name = "MatterAiRestrictedError";
    }
}

/** The restriction refusal, when `error` is one or was caused by one. */
export function matterAiRestrictedError(
    error: unknown,
): MatterAiRestrictedError | null {
    let current = error;
    const seen = new Set<unknown>();
    for (let depth = 0; depth < 8 && current && !seen.has(current); depth++) {
        if (current instanceof MatterAiRestrictedError) return current;
        seen.add(current);
        current =
            typeof current === "object"
                ? (current as { cause?: unknown }).cause
                : undefined;
    }
    return null;
}

/**
 * Whether a matter has AI switched off. A read failure throws: answering
 * "allowed" would wave a restricted matter through. No matter (a null id) is
 * never restricted.
 */
export async function isMatterAiRestricted(
    db: Db,
    projectId: string | null | undefined,
): Promise<boolean> {
    if (!projectId) return false;
    const { data, error } = await db
        .from("projects")
        .select("ai_restricted")
        .eq("id", projectId)
        .maybeSingle();
    if (error) throw new Error("Failed to read the matter's AI setting");
    return (data as { ai_restricted?: boolean } | null)?.ai_restricted === true;
}

/** Refuse if the matter has AI switched off. A no-op when there is no matter. */
export async function assertMatterAllowsAi(
    db: Db,
    projectId: string | null | undefined,
): Promise<void> {
    if (projectId && (await isMatterAiRestricted(db, projectId)))
        throw new MatterAiRestrictedError(projectId);
}

/**
 * Of `documentIds`, the id of the first matter with AI switched off that any of
 * them belongs to, or null. A document follows its project; documents in no
 * project, and ids that name no document, are never restricted. A read failure
 * throws, so a restricted matter is never waved through on an error.
 */
export async function restrictedMatterAmongDocuments(
    db: Db,
    documentIds: Iterable<string | null | undefined>,
): Promise<string | null> {
    const ids = [
        ...new Set(
            [...documentIds].filter(
                (id): id is string => typeof id === "string" && id.length > 0,
            ),
        ),
    ];
    if (ids.length === 0) return null;
    const { data, error } = await db
        .from("documents")
        .select("project_id")
        .in("id", ids);
    if (error) throw new Error("Failed to read the documents' matters");
    const projectIds = [
        ...new Set(
            ((data ?? []) as { project_id?: string | null }[]).flatMap((row) =>
                row.project_id ? [row.project_id] : [],
            ),
        ),
    ];
    if (projectIds.length === 0) return null;
    const { data: restricted, error: projectsError } = await db
        .from("projects")
        .select("id")
        .in("id", projectIds)
        .eq("ai_restricted", true)
        .limit(1);
    if (projectsError) throw new Error("Failed to read the matters' AI settings");
    return (restricted as { id: string }[] | null)?.[0]?.id ?? null;
}

/** Refuse if any of the attached documents belongs to a restricted matter. */
export async function assertDocumentsAllowAi(
    db: Db,
    documentIds: Iterable<string | null | undefined>,
): Promise<void> {
    const restricted = await restrictedMatterAmongDocuments(db, documentIds);
    if (restricted) throw new MatterAiRestrictedError(restricted);
}
