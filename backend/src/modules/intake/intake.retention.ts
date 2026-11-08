// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: retention of public form submissions.
//
// A request submitted through a form carries a requester's name, email and
// free text, collected under the form's notice that it is kept for a stated
// time. Once a submission has not been turned into a matter within its form's
// retention_days, this sweep deletes it (comments cascade; the ids-only audit
// rows stay). A submission that became a matter is kept with the matter.
//
// The deletion runs in request_desk_delete_expired_form_submissions, a
// security-definer function (20261108_50_request_desk_forms.sql), so the
// backend role never holds DELETE on request_desk_requests. jobs/maintenance.ts
// runs it on the maintenance interval.

import { AppError } from "../../lib/appError";
import type { Db } from "../../lib/supabase";

// Bounded batches keep each delete short; a sweep stops after
// RETENTION_MAX_BATCHES, so a backlog drains over a few sweeps.
const RETENTION_BATCH_SIZE = 500;
const RETENTION_MAX_BATCHES = 20;

/**
 * Delete form submissions past their form's retention period that never
 * became a matter; returns how many it deleted.
 */
export async function deleteExpiredFormSubmissions(db: Db): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
        const { data, error } = await db.rpc(
            "request_desk_delete_expired_form_submissions",
            { p_limit: RETENTION_BATCH_SIZE },
        );
        if (error) {
            throw new AppError(
                "request_desk.retention_failed",
                "Deleting expired request form submissions failed",
                { cause: error },
            );
        }
        const deleted = typeof data === "number" ? data : 0;
        total += deleted;
        if (deleted < RETENTION_BATCH_SIZE) break;
    }
    return total;
}
