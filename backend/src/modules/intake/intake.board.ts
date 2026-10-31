// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: the triage board's counts, computed by the database
// (request_desk_board_summary) so they are exact however many requests an
// organization has, rather than counted from whatever page a client loaded.

import type {
    RequestDeskBoardSummary,
    RequestDeskPriority,
    RequestDeskStatus,
} from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    REQUEST_PRIORITIES,
    REQUEST_STATUSES,
    resolveRequestDeskOrg,
    type RequestDeskCaller,
} from "./intake.shared";

function count(value: unknown): number {
    const number = typeof value === "string" ? Number(value) : value;
    return typeof number === "number" && Number.isFinite(number) && number >= 0
        ? Math.trunc(number)
        : 0;
}

function counts<K extends string>(
    keys: readonly K[],
    raw: unknown,
): Record<K, number> {
    const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return Object.fromEntries(keys.map((key) => [key, count(source[key])])) as Record<K, number>;
}

/** The summary from the function's JSON, every count a non-negative integer. */
export function readBoardSummary(
    data: unknown,
    orgId: string,
    generatedAt: Date = new Date(),
): RequestDeskBoardSummary {
    const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return {
        org_id: orgId,
        total: count(raw.total),
        open: count(raw.open),
        overdue: count(raw.overdue),
        unassigned: count(raw.unassigned),
        assigned_to_me: count(raw.assigned_to_me),
        by_status: counts<RequestDeskStatus>(REQUEST_STATUSES, raw.by_status),
        open_by_priority: counts<RequestDeskPriority>(
            REQUEST_PRIORITIES,
            raw.open_by_priority,
        ),
        generated_at: generatedAt.toISOString(),
    };
}

export async function getRequestDeskBoard(
    db: Db,
    args: RequestDeskCaller & { workspace: unknown },
): Promise<ServiceResult<RequestDeskBoardSummary>> {
    const scope = await resolveRequestDeskOrg(db, args.userId, args.workspace);
    if (!scope.ok) return scope;
    const { data, error } = await db.rpc("request_desk_board_summary", {
        p_org_id: scope.data.orgId,
        p_user_id: args.userId,
    });
    if (error) return internalFailure(error);
    return ok(readBoardSummary(data, scope.data.orgId));
}
