// SPDX-License-Identifier: AGPL-3.0-only
//
// The report behind `npm run report:usage`: tokens and estimated cost per
// run, per document and per page, read from the usage ledger
// (public.usage_events) and priced with the operator's own price table
// (USAGE_PRICE_TABLE_JSON, which lives in the deployment's environment and is
// never committed).
//
// Every cost here is an estimate: the ledger's token counts times the
// operator's prices. A provider's invoice is the authority; prompt-cache
// writes, minimum charges and discounts are not modelled.

import type { Db } from "./supabase";

export const PRICE_TABLE_VARIABLE = "USAGE_PRICE_TABLE_JSON";

/** Prices in the table's currency per million tokens. */
export type ModelPrice = { input: number; output: number; cachedInput: number };

export type PriceTable = {
    currency: string;
    /** Exact model ids, or a prefix ending in `*` (the longest match wins). */
    models: Map<string, ModelPrice>;
};

export type UsageRow = {
    created_at: string;
    org_id: string;
    user_id: string | null;
    project_id: string | null;
    surface: string;
    model: string;
    provider: string;
    key_source: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    document_pages: number | null;
    chat_id: string | null;
    review_id: string | null;
    run_id: string | null;
    document_id: string | null;
};

export const USAGE_ROW_COLUMNS =
    "created_at, org_id, user_id, project_id, surface, model, provider, key_source, input_tokens, output_tokens, cached_tokens, document_pages, chat_id, review_id, run_id, document_id";

const PRICE_TABLE_EXAMPLE =
    '{"currency":"USD","models":{"model-id":{"input":1.0,"output":2.0,"cached_input":0.1}}}';

function price(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
}

/** The operator's price table, or why it cannot be used. */
export function parsePriceTable(
    raw: string | undefined,
): { ok: true; table: PriceTable } | { ok: false; error: string } {
    if (!raw?.trim()) {
        return {
            ok: false,
            error: `${PRICE_TABLE_VARIABLE} is not set. Set it to your prices per million tokens, for example ${PRICE_TABLE_EXAMPLE}`,
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, error: `${PRICE_TABLE_VARIABLE} is not valid JSON.` };
    }
    const record =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    const models =
        record?.models &&
        typeof record.models === "object" &&
        !Array.isArray(record.models)
            ? (record.models as Record<string, unknown>)
            : null;
    if (!record || !models) {
        return {
            ok: false,
            error: `${PRICE_TABLE_VARIABLE} must be an object with a "models" object, for example ${PRICE_TABLE_EXAMPLE}`,
        };
    }
    const table: PriceTable = {
        currency:
            typeof record.currency === "string" && record.currency.trim()
                ? record.currency.trim()
                : "USD",
        models: new Map(),
    };
    for (const [model, value] of Object.entries(models)) {
        const entry =
            value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
        const input = price(entry.input);
        const output = price(entry.output);
        const cachedInput =
            entry.cached_input === undefined ? input : price(entry.cached_input);
        if (!model.trim() || input === null || output === null || cachedInput === null) {
            return {
                ok: false,
                error: `${PRICE_TABLE_VARIABLE}: the price for "${model}" needs "input" and "output" (and optionally "cached_input") as numbers of 0 or more.`,
            };
        }
        table.models.set(model.trim(), { input, output, cachedInput });
    }
    return { ok: true, table };
}

/** The price for a model id: an exact entry, else the longest `prefix*` entry. */
export function priceFor(table: PriceTable, model: string): ModelPrice | null {
    const exact = table.models.get(model);
    if (exact) return exact;
    let best: { length: number; price: ModelPrice } | null = null;
    for (const [key, entry] of table.models) {
        if (!key.endsWith("*")) continue;
        const prefix = key.slice(0, -1);
        if (model.startsWith(prefix) && (!best || prefix.length > best.length)) {
            best = { length: prefix.length, price: entry };
        }
    }
    return best?.price ?? null;
}

/** A count as stored (PostgREST may send a bigint as a string), 0 if unusable. */
function whole(value: unknown): number {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** One call's estimated cost in the table's currency. */
export function estimatedCost(row: UsageRow, entry: ModelPrice): number {
    const input = whole(row.input_tokens);
    const cached = Math.min(whole(row.cached_tokens), input);
    const output = whole(row.output_tokens);
    return (
        ((input - cached) * entry.input +
            cached * entry.cachedInput +
            output * entry.output) /
        1_000_000
    );
}

export type UsageTotals = {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    /** Pages of the documents read, where the ledger knows them. */
    pages: number;
    /** Estimated cost of the priced calls. */
    estimatedCost: number;
    /** Estimated cost per page, over priced calls with a known page count. */
    estimatedCostPerPage: number | null;
    /** Calls whose model has no price: their tokens count, their cost does not. */
    unpricedCalls: number;
};

export type UsageGroup = UsageTotals & {
    kind: "run" | "review" | "chat" | "document" | "unattributed";
    id: string | null;
    surfaces: string[];
};

export type UsageReport = {
    currency: string;
    totals: UsageTotals;
    byKeySource: Record<string, UsageTotals>;
    byRun: UsageGroup[];
    byDocument: UsageGroup[];
    unpricedModels: Array<{ model: string; calls: number }>;
};

class Accumulator {
    calls = 0;
    inputTokens = 0;
    outputTokens = 0;
    cachedTokens = 0;
    pages = 0;
    estimatedCost = 0;
    unpricedCalls = 0;
    private pricedPages = 0;
    private pricedPagesCost = 0;
    readonly surfaces = new Set<string>();

    add(row: UsageRow, cost: number | null): void {
        this.calls += 1;
        this.inputTokens += whole(row.input_tokens);
        this.outputTokens += whole(row.output_tokens);
        this.cachedTokens += whole(row.cached_tokens);
        this.surfaces.add(row.surface);
        const pages =
            row.document_pages === null || row.document_pages === undefined
                ? null
                : whole(row.document_pages);
        if (pages !== null) this.pages += pages;
        if (cost === null) {
            this.unpricedCalls += 1;
            return;
        }
        this.estimatedCost += cost;
        if (pages) {
            this.pricedPages += pages;
            this.pricedPagesCost += cost;
        }
    }

    totals(): UsageTotals {
        return {
            calls: this.calls,
            inputTokens: this.inputTokens,
            outputTokens: this.outputTokens,
            cachedTokens: this.cachedTokens,
            pages: this.pages,
            estimatedCost: this.estimatedCost,
            estimatedCostPerPage: this.pricedPages
                ? this.pricedPagesCost / this.pricedPages
                : null,
            unpricedCalls: this.unpricedCalls,
        };
    }
}

/** What a call was part of: its run, else its review, else its chat. */
function runOf(row: UsageRow): Pick<UsageGroup, "kind" | "id"> {
    if (row.run_id) return { kind: "run", id: row.run_id };
    if (row.review_id) return { kind: "review", id: row.review_id };
    if (row.chat_id) return { kind: "chat", id: row.chat_id };
    return { kind: "unattributed", id: null };
}

function grouped(
    groups: Map<string, { key: Pick<UsageGroup, "kind" | "id">; sum: Accumulator }>,
): UsageGroup[] {
    return [...groups.values()]
        .map(({ key, sum }) => ({
            ...key,
            ...sum.totals(),
            surfaces: [...sum.surfaces].sort(),
        }))
        .sort((a, b) => b.estimatedCost - a.estimatedCost || b.calls - a.calls);
}

/** Totals, then per run, per document and per page, for the rows given. */
export function buildUsageReport(rows: UsageRow[], table: PriceTable): UsageReport {
    const totals = new Accumulator();
    const byKeySource = new Map<string, Accumulator>();
    const byRun = new Map<string, { key: Pick<UsageGroup, "kind" | "id">; sum: Accumulator }>();
    const byDocument = new Map<string, { key: Pick<UsageGroup, "kind" | "id">; sum: Accumulator }>();
    const unpriced = new Map<string, number>();

    for (const row of rows) {
        const entry = priceFor(table, row.model);
        const cost = entry ? estimatedCost(row, entry) : null;
        if (!entry) unpriced.set(row.model, (unpriced.get(row.model) ?? 0) + 1);
        totals.add(row, cost);

        const source = byKeySource.get(row.key_source) ?? new Accumulator();
        source.add(row, cost);
        byKeySource.set(row.key_source, source);

        const run = runOf(row);
        const runKey = `${run.kind}:${run.id ?? ""}`;
        const runGroup = byRun.get(runKey) ?? { key: run, sum: new Accumulator() };
        runGroup.sum.add(row, cost);
        byRun.set(runKey, runGroup);

        if (row.document_id) {
            const documentGroup = byDocument.get(row.document_id) ?? {
                key: { kind: "document" as const, id: row.document_id },
                sum: new Accumulator(),
            };
            documentGroup.sum.add(row, cost);
            byDocument.set(row.document_id, documentGroup);
        }
    }

    return {
        currency: table.currency,
        totals: totals.totals(),
        byKeySource: Object.fromEntries(
            [...byKeySource.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([source, sum]) => [source, sum.totals()]),
        ),
        byRun: grouped(byRun),
        byDocument: grouped(byDocument),
        unpricedModels: [...unpriced.entries()]
            .map(([model, calls]) => ({ model, calls }))
            .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    };
}

// ---------------------------------------------------------------------------
// Text output
// ---------------------------------------------------------------------------

function money(value: number | null): string {
    return value === null ? "-" : value.toFixed(4);
}

function table(headers: string[], rows: string[][]): string {
    const widths = headers.map((header, index) =>
        Math.max(header.length, ...rows.map((row) => row[index].length)),
    );
    const line = (cells: string[]) =>
        cells
            .map((cell, index) =>
                index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]),
            )
            .join("  ")
            .trimEnd();
    return [line(headers), ...rows.map(line)].map((text) => `  ${text}`).join("\n");
}

function totalsCells(totals: UsageTotals): string[] {
    return [
        String(totals.calls),
        String(totals.inputTokens),
        String(totals.outputTokens),
        String(totals.cachedTokens),
        String(totals.pages),
        money(totals.estimatedCost),
        money(totals.estimatedCostPerPage),
    ];
}

export type ReportScope = {
    /** The calendar month, YYYY-MM, in UTC. */
    month: string;
    orgId: string | null;
    projectId: string | null;
};

/** The report as text, with every cost labelled as an estimate. */
export function formatUsageReport(report: UsageReport, scope: ReportScope): string {
    const currency = report.currency;
    const numbers = [
        "calls",
        "input tokens",
        "output tokens",
        "cached tokens",
        "pages",
        `est. cost (${currency})`,
        `est. per page (${currency})`,
    ];
    const where = [
        scope.orgId ? `organization ${scope.orgId}` : "all organizations",
        ...(scope.projectId ? [`matter ${scope.projectId}`] : []),
    ].join(", ");
    const sections = [
        `AI usage for ${scope.month} (UTC), ${where}`,
        `Costs are estimates: recorded tokens times the prices in ${PRICE_TABLE_VARIABLE} (${currency} per million tokens). The provider's invoice is the authority.`,
        "",
        "Totals",
        table(["", ...numbers], [["all calls", ...totalsCells(report.totals)]]),
        "",
        "By key source (user: a person's own key, org: an organization's key, env: the deployment's)",
        table(
            ["key source", ...numbers],
            Object.entries(report.byKeySource).map(([source, totals]) => [
                source,
                ...totalsCells(totals),
            ]),
        ),
        "",
        "Per run (a playbook run, tabular generation or subagent; else the review or chat)",
        report.byRun.length
            ? table(
                  ["run", "surfaces", ...numbers],
                  report.byRun.map((group) => [
                      group.id ? `${group.kind} ${group.id}` : "not attributed",
                      group.surfaces.join(","),
                      ...totalsCells(group),
                  ]),
              )
            : "  (no calls)",
        "",
        "Per document (calls that read one document)",
        report.byDocument.length
            ? table(
                  ["document", "surfaces", ...numbers],
                  report.byDocument.map((group) => [
                      group.id ?? "",
                      group.surfaces.join(","),
                      ...totalsCells(group),
                  ]),
              )
            : "  (no calls with one document)",
        "",
        "Per page",
        report.totals.estimatedCostPerPage === null
            ? "  No priced calls with a known page count."
            : `  ${report.totals.pages} pages read; estimated ${money(report.totals.estimatedCostPerPage)} ${currency} per page.`,
    ];
    if (report.unpricedModels.length) {
        sections.push(
            "",
            `Models without a price in ${PRICE_TABLE_VARIABLE} (tokens counted, cost left out):`,
            ...report.unpricedModels.map(
                ({ model, calls }) => `  ${model} (${calls} ${calls === 1 ? "call" : "calls"})`,
            ),
        );
    }
    return sections.join("\n");
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UsageRowFilter = {
    from: Date;
    to: Date;
    orgId: string | null;
    projectId: string | null;
};

const USAGE_HELP = `Usage: npm run report:usage --prefix backend -- [--month YYYY-MM] [--org <uuid>] [--project <uuid>] [--json]

Tokens and estimated cost per run, per document and per page from the usage
ledger, for one calendar month (UTC; the current month by default). Prices
come from ${PRICE_TABLE_VARIABLE}, per million tokens:
  ${PRICE_TABLE_EXAMPLE}
A key ending in * prices every model id that starts with the text before it.`;

function parseArgs(
    argv: string[],
    now: Date,
):
    | { ok: true; filter: UsageRowFilter; scope: ReportScope; json: boolean }
    | { ok: false; error: string; help?: true } {
    let month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    let orgId: string | null = null;
    let projectId: string | null = null;
    let json = false;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") return { ok: false, error: USAGE_HELP, help: true };
        if (arg === "--json") {
            json = true;
            continue;
        }
        const value = argv[index + 1] ?? "";
        if (arg === "--month") {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
                return { ok: false, error: `--month needs a month as YYYY-MM.\n\n${USAGE_HELP}` };
            month = value;
        } else if (arg === "--org" || arg === "--project") {
            if (!UUID_RE.test(value))
                return { ok: false, error: `${arg} needs a uuid.\n\n${USAGE_HELP}` };
            if (arg === "--org") orgId = value;
            else projectId = value;
        } else {
            return { ok: false, error: `Unrecognised argument "${arg}".\n\n${USAGE_HELP}` };
        }
        index += 1;
    }
    const [year, monthNumber] = month.split("-").map(Number);
    return {
        ok: true,
        filter: {
            from: new Date(Date.UTC(year, monthNumber - 1, 1)),
            to: new Date(Date.UTC(year, monthNumber, 1)),
            orgId,
            projectId,
        },
        scope: { month, orgId, projectId },
        json,
    };
}

/** The ledger rows for a month, oldest first, a page at a time. */
export async function loadUsageRows(
    db: Db,
    filter: UsageRowFilter,
): Promise<UsageRow[]> {
    const rows: UsageRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
        let query = db
            .from("usage_events")
            .select(USAGE_ROW_COLUMNS)
            .gte("created_at", filter.from.toISOString())
            .lt("created_at", filter.to.toISOString());
        if (filter.orgId) query = query.eq("org_id", filter.orgId);
        if (filter.projectId) query = query.eq("project_id", filter.projectId);
        const { data, error } = await query
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as UsageRow[];
        rows.push(...page);
        if (page.length < pageSize) return rows;
    }
}

/**
 * Run the report and return the process exit code: 0 when it printed, 1 when
 * the price table or the arguments cannot be used (the message says which).
 * The price table is checked first, before anything is read.
 */
export async function runUsageReport(options: {
    argv: string[];
    env: NodeJS.ProcessEnv;
    loadRows: (filter: UsageRowFilter) => Promise<UsageRow[]>;
    out: (text: string) => void;
    err: (text: string) => void;
    now?: Date;
}): Promise<number> {
    const args = parseArgs(options.argv, options.now ?? new Date());
    if (!args.ok && args.help) {
        options.out(args.error);
        return 0;
    }
    const prices = parsePriceTable(options.env[PRICE_TABLE_VARIABLE]);
    if (!prices.ok) {
        options.err(prices.error);
        return 1;
    }
    if (!args.ok) {
        options.err(args.error);
        return 1;
    }
    const report = buildUsageReport(await options.loadRows(args.filter), prices.table);
    options.out(
        args.json
            ? JSON.stringify({ ...args.scope, estimates: true, ...report }, null, 2)
            : formatUsageReport(report, args.scope),
    );
    return 0;
}
