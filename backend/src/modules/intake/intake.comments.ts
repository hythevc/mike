// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: a request's activity trail. Every member who can see a
// request can read its trail and comment on it, viewers included. Status
// changes and system entries are written by the operations that cause them
// (intake.transitions.ts, intake.matter.ts), never through here.

import type { RequestDeskComment } from "@mike/contracts";
import { AppError } from "../../lib/appError";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    COMMENT_COLUMNS,
    asRecord,
    loadRequestForCaller,
    recordRequestDeskAudit,
    serializeComments,
    type CommentRow,
    type RequestDeskCaller,
} from "./intake.shared";

/** The trail is returned whole, oldest first, up to this many entries. */
export const MAX_TRAIL_ENTRIES = 1000;
const MAX_COMMENT_LENGTH = 10000;

export async function listRequestComments(
    db: Db,
    args: RequestDeskCaller & { requestId: string },
): Promise<ServiceResult<RequestDeskComment[]>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    const { request } = loaded.data;
    const { data, error } = await db
        .from("request_desk_comments")
        .select(COMMENT_COLUMNS)
        .eq("request_id", request.id)
        .eq("org_id", request.org_id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(0, MAX_TRAIL_ENTRIES - 1);
    if (error) return internalFailure(error);
    return serializeComments(db, (data ?? []) as unknown as CommentRow[]);
}

export async function addRequestComment(
    db: Db,
    args: RequestDeskCaller & { requestId: string; body: unknown },
): Promise<ServiceResult<RequestDeskComment>> {
    const loaded = await loadRequestForCaller(db, args.requestId, args);
    if (!loaded.ok) return loaded;
    const { request } = loaded.data;

    const text = asRecord(args.body).body;
    if (typeof text !== "string" || !text.trim())
        return failure("validation", "body is required");
    if (text.length > MAX_COMMENT_LENGTH)
        return failure(
            "validation",
            `body must be at most ${MAX_COMMENT_LENGTH} characters`,
        );

    const { data, error } = await db
        .from("request_desk_comments")
        .insert({
            request_id: request.id,
            org_id: request.org_id,
            author_user_id: args.userId,
            kind: "comment",
            body: text.trim(),
        })
        .select(COMMENT_COLUMNS)
        .single();
    if (error) return internalFailure(error);
    if (!data)
        return internalFailure(
            new AppError("request_desk.comment_failed", "comment insert returned no row"),
        );
    const comment = data as unknown as CommentRow;

    await recordRequestDeskAudit(db, {
        caller: args,
        orgId: request.org_id,
        action: "request.commented",
        ids: { request_id: request.id, comment_id: comment.id },
    });
    const serialized = await serializeComments(db, [comment]);
    if (!serialized.ok) return serialized;
    return ok(serialized.data[0]);
}
