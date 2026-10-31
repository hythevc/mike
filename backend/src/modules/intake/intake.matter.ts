// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: create a matter from a request.
//
// The matter is an ordinary project in the request's organization, created
// through the projects facade, so it follows the project access rules: the
// person who creates it owns it, and it is private unless they open it to the
// organization. The request then links it, once, with a trail entry.

import type { RequestDeskChange } from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/sentry";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { createProject, deleteProject } from "../projects/projects.service";
import {
    CHANGE_FORBIDDEN_DETAIL,
    REQUEST_DESK_MATTER_LINKED,
    REQUEST_NOT_FOUND,
    asRecord,
    loadRequestForCaller,
    parseOptionalText,
    readDeskOutcome,
    recordRequestDeskAudit,
    serializeComments,
    serializeRequest,
    type RequestDeskCaller,
} from "./intake.shared";

const MATTER_LINKED_DETAIL = "A matter has already been created from this request.";

export type MatterFromRequest = RequestDeskChange & {
    /** The created project, as POST /projects returns it. */
    project: Record<string, unknown>;
};

/**
 * Remove a matter this call created but could not link, so a lost race does
 * not leave a stray empty project. Best effort: a failure is reported, and
 * the caller still gets the answer about the link.
 */
async function discardUnlinkedMatter(
    db: Db,
    caller: RequestDeskCaller,
    projectId: string,
): Promise<void> {
    const removed = await deleteProject(db, {
        projectId,
        userId: caller.userId,
        userEmail: caller.userEmail ?? undefined,
    }).catch((error: unknown) => ({ ok: false as const, kind: "error" as const, error }));
    if (removed.ok) return;
    const failed = new AppError(
        "request_desk.matter_discard_failed",
        "an unlinked matter could not be removed",
        { cause: "error" in removed ? removed.error : undefined },
    );
    reportError(failed, { tags: { operation: "request_desk.create_matter" } });
    console.error("[intake] unlinked matter left in place:", failed);
}

/**
 * Create a matter from a request and link it. Owners and editors only. The
 * body may name the matter (default: the request's title) and set
 * `cm_number`, `practice` and `visibility` as POST /projects does.
 */
export async function createMatterFromRequest(
    db: Db,
    args: RequestDeskCaller & { requestId: string; body: unknown },
): Promise<ServiceResult<MatterFromRequest>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    const { request, orgRole, role } = loaded.data;
    if (role === "viewer") return failure("forbidden", CHANGE_FORBIDDEN_DETAIL);
    if (request.project_id)
        return failure("conflict", MATTER_LINKED_DETAIL, REQUEST_DESK_MATTER_LINKED);

    const body = asRecord(args.body);
    const name = parseOptionalText(body.name, "name", 200);
    if (!name.ok) return failure("validation", name.detail);
    const cmNumber = parseOptionalText(body.cm_number, "cm_number", 100);
    if (!cmNumber.ok) return failure("validation", cmNumber.detail);
    const practice = parseOptionalText(body.practice, "practice", 100);
    if (!practice.ok) return failure("validation", practice.detail);

    const created = await createProject(db, {
        userId: args.userId,
        name: name.value ?? request.title,
        cm_number: cmNumber.value ?? undefined,
        practice: practice.value ?? undefined,
        org_id: request.org_id,
        visibility: body.visibility,
    });
    if (!created.ok) {
        if (created.kind === "validation")
            return failure("validation", created.detail);
        return internalFailure(created.error);
    }
    const project = created.project;
    const projectId = project.id;
    if (typeof projectId !== "string")
        return internalFailure(
            new AppError("request_desk.matter_failed", "createProject returned no id"),
        );

    const { data, error } = await db.rpc("request_desk_link_matter", {
        p_request_id: request.id,
        p_org_id: request.org_id,
        p_actor_id: args.userId,
        p_project_id: projectId,
    });
    const outcome = error ? null : readDeskOutcome(data);
    if (!outcome || outcome.outcome !== "changed") {
        await discardUnlinkedMatter(db, args, projectId);
        if (error) return internalFailure(error);
        if (outcome?.outcome === "conflict")
            return failure("conflict", MATTER_LINKED_DETAIL, REQUEST_DESK_MATTER_LINKED);
        if (outcome?.outcome === "not_found")
            return failure("not_found", REQUEST_NOT_FOUND);
        return internalFailure(
            new AppError("request_desk.outcome_unreadable", "request desk function returned an unknown outcome"),
        );
    }

    await recordRequestDeskAudit(db, {
        caller: args,
        orgId: request.org_id,
        action: "request.matter_created",
        projectId,
        ids: { request_id: request.id, comment_id: outcome.comment.id },
    });
    const [serialized, comments] = await Promise.all([
        serializeRequest(db, outcome.request, args, orgRole),
        serializeComments(db, [outcome.comment]),
    ]);
    if (!serialized.ok) return serialized;
    if (!comments.ok) return comments;
    return ok({
        changed: true,
        request: serialized.data,
        comment: comments.data[0],
        project,
    });
}
