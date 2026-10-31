// SPDX-License-Identifier: AGPL-3.0-only
//
// Usage attribution for playbook work (lib/usage.ts): a review's or an
// import's model calls are recorded in the playbook's workspace under the
// run or import attempt, and a review of a saved document also carries that
// document's matter and page count.

import type { UsageContext } from "../../lib/llm/usageContext";
import type { Db } from "../../lib/supabase";

/** The usage context of one review run. */
export async function playbookReviewUsage(
    db: Db,
    run: {
        userId: string;
        orgId: string | null;
        runId: string;
        documentId: string | null;
        versionId: string | null;
    },
): Promise<UsageContext> {
    const usage: UsageContext = {
        userId: run.userId,
        orgId: run.orgId,
        projectId: null,
        surface: "playbook",
        runId: run.runId,
        documentId: run.documentId,
        documentPages: null,
    };
    if (!run.documentId) return usage;
    try {
        const [document, version] = await Promise.all([
            db
                .from("documents")
                .select("project_id")
                .eq("id", run.documentId)
                .maybeSingle(),
            run.versionId
                ? db
                      .from("document_versions")
                      .select("page_count")
                      .eq("id", run.versionId)
                      .maybeSingle()
                : Promise.resolve({ data: null }),
        ]);
        const projectId = (document.data as { project_id?: unknown } | null)
            ?.project_id;
        const pages = (version.data as { page_count?: unknown } | null)
            ?.page_count;
        return {
            ...usage,
            projectId: typeof projectId === "string" ? projectId : null,
            documentPages: typeof pages === "number" ? pages : null,
        };
    } catch {
        // Attribution never decides whether a review runs.
        return usage;
    }
}

/** The usage context of one import attempt's compile calls. */
export function playbookImportUsage(work: {
    userId: string;
    orgId: string | null;
    attemptId: string;
}): UsageContext {
    return {
        userId: work.userId,
        orgId: work.orgId,
        projectId: null,
        surface: "playbook",
        runId: work.attemptId,
    };
}
