// SPDX-License-Identifier: AGPL-3.0-only
//
// Per-matter AI usage (W18).
//
// What AI work a matter has cost, read from the usage ledger
// (public.usage_events) and priced with the operator's own price table
// (USAGE_PRICE_TABLE_JSON, which lives in the deployment's environment and is
// never committed). Open to anyone who can open the matter, so a firm can pass
// AI cost through to the client at actual cost.
//
// Every cost here is an estimate: the ledger's recorded token counts times the
// operator's prices. A provider's invoice is the authority; the label says so
// wherever a cost is shown. When no price table is configured, costs are left
// blank and `priced` is false.

import { checkProjectAccess } from "../../lib/access";
import {
    estimatedCost,
    parsePriceTable,
    priceFor,
    PRICE_TABLE_VARIABLE,
    type PriceTable,
    type UsageRow,
    USAGE_ROW_COLUMNS,
} from "../../lib/usageReport";
import { type Db } from "./projects.shared";
import type {
    ProjectUsageEntry,
    ProjectUsageReport,
} from "@mike/contracts";

export type ProjectUsageResult =
    | { ok: true; report: ProjectUsageReport }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "db_error"; error: unknown };

// A matter's ledger is bounded in practice; this cap keeps one runaway matter
// from loading an unbounded response.
const MAX_ROWS = 10_000;
const PAGE_SIZE = 1000;

/** The usage-ledger rows for one matter, newest first, up to MAX_ROWS. */
async function loadProjectUsageRows(
    db: Db,
    projectId: string,
): Promise<UsageRow[]> {
    const rows: UsageRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        const { data, error } = await db
            .from("usage_events")
            .select(USAGE_ROW_COLUMNS)
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, Math.min(from + PAGE_SIZE, MAX_ROWS) - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as UsageRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

/** Resolve each user's email for the "who" column; best-effort (empty on error). */
async function emailsByUserId(
    db: Db,
    userIds: string[],
): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const map = new Map<string, string>();
    try {
        const { data } = await db
            .from("user_profiles")
            .select("user_id, email")
            .in("user_id", ids);
        for (const row of (data ?? []) as {
            user_id: string;
            email?: string | null;
        }[])
            if (row.email) map.set(row.user_id, row.email);
    } catch {
        // The "who" column falls back to the user id; a lookup failure must
        // not fail the whole report.
    }
    return map;
}

const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * The matter's AI usage, for a user who can open it. Returns `not_found` with
 * the same shape as a missing matter when the caller cannot open it, so a
 * viewer learns nothing about matters they cannot see.
 */
export async function getProjectUsage(
    db: Db,
    args: { projectId: string; userId: string; userEmail?: string },
): Promise<ProjectUsageResult> {
    const access = await checkProjectAccess(
        args.projectId,
        args.userId,
        args.userEmail,
        db,
    );
    if (!access.ok) return { ok: false, kind: "not_found" };

    let rows: UsageRow[];
    try {
        rows = await loadProjectUsageRows(db, args.projectId);
    } catch (error) {
        return { ok: false, kind: "db_error", error };
    }

    const prices = parsePriceTable(process.env[PRICE_TABLE_VARIABLE]);
    const table: PriceTable | null = prices.ok ? prices.table : null;
    const emails = await emailsByUserId(
        db,
        rows.flatMap((row) => (row.user_id ? [row.user_id] : [])),
    );

    const entries: ProjectUsageEntry[] = rows.map((row) => {
        const price = table ? priceFor(table, row.model) : null;
        return {
            created_at: row.created_at,
            user_id: row.user_id,
            user_email: row.user_id ? (emails.get(row.user_id) ?? null) : null,
            surface: row.surface,
            model: row.model,
            provider: row.provider,
            key_source: row.key_source,
            input_tokens: toNumber(row.input_tokens),
            output_tokens: toNumber(row.output_tokens),
            cached_tokens: toNumber(row.cached_tokens),
            tokens_estimated: row.tokens_estimated === true,
            document_pages:
                row.document_pages === null || row.document_pages === undefined
                    ? null
                    : toNumber(row.document_pages),
            estimated_cost: price ? estimatedCost(row, price) : null,
        };
    });

    return {
        ok: true,
        report: {
            estimates: true,
            currency: table?.currency ?? null,
            priced: table !== null,
            rows: entries,
        },
    };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
    const text = value === null || value === undefined ? "" : String(value);
    // Guard against a leading =, +, - or @ being read as a formula by a
    // spreadsheet, and quote anything with a separator or quote in it.
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(guarded)
        ? `"${guarded.replace(/"/g, '""')}"`
        : guarded;
}

/** The report as CSV, with the cost column labelled an estimate in its header. */
export function projectUsageCsv(report: ProjectUsageReport): string {
    const currency = report.currency ? ` (${report.currency})` : "";
    const header = [
        "When (UTC)",
        "Who",
        "Surface",
        "Model",
        "Provider",
        "Key source",
        "Input tokens",
        "Output tokens",
        "Cached tokens",
        "Tokens estimated",
        "Document pages",
        `Estimated cost${currency}`,
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const row of report.rows) {
        lines.push(
            [
                row.created_at,
                row.user_email ?? row.user_id ?? "",
                row.surface,
                row.model,
                row.provider,
                row.key_source,
                row.input_tokens,
                row.output_tokens,
                row.cached_tokens,
                row.tokens_estimated ? "yes" : "no",
                row.document_pages ?? "",
                row.estimated_cost === null ? "" : row.estimated_cost.toFixed(6),
            ]
                .map(csvCell)
                .join(","),
        );
    }
    return lines.join("\r\n") + "\r\n";
}
