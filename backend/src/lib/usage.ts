// SPDX-License-Identifier: AGPL-3.0-only
//
// The AI usage ledger (public.usage_events) and the monthly cap on the
// deployment's own provider keys.
//
// The provider layer (llm/aiSdk.ts) records one row per model call with
// `recordUsage`, attributed through the usage context its entry point set
// (llm/usageContext.ts). Recording never fails the call: a lost row is
// reported and the answer goes on.
//
// Before a call that would run on a key from the deployment's environment,
// llm/providers.ts asks `assertDeploymentKeyAllowance`. With
// DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP set, the call is refused before any
// provider request once this calendar month's (UTC) deployment-key tokens
// have reached the cap, counted twice: for the workspace (an organization,
// or a person's Personal workspace) and for the person across every
// workspace they work in, so an organization someone creates brings them no
// new allowance. Keys a person or an organization saved are recorded but
// never capped. Unset, nothing is capped, as before the ledger existed.
//
// Each process reuses a total it has read from the ledger for
// DEPLOYMENT_TOTALS_TTL_MS per workspace and person, and adds the calls it
// records to it as they finish, so a tabular review does not total the
// month again for every row.

import { AppError } from "./appError";
import type { KeySource } from "./llm/types";
import { currentUsageContext, type UsageContext } from "./llm/usageContext";
import { reportError } from "./observability/sentry";
import { createServerSupabase } from "./supabase";
import { UserFacingError } from "./userFacingError";

export type { KeySource };

export type ModelUsage = {
    inputTokens: number;
    outputTokens: number;
    /** Input tokens served from the provider's prompt cache. */
    cachedTokens: number;
};

export type ModelCall = {
    model: string;
    provider: string;
    keySource: KeySource;
    usage: ModelUsage;
    /**
     * Some of the tokens are an estimate: a model call was cut off before
     * its provider reported them, or the provider reports none
     * (llm/usageMeter.ts).
     */
    estimated?: boolean;
};

export const DEPLOYMENT_QUOTA_EXCEEDED_CODE = "deployment_quota_exceeded";

const OWN_KEY_REMEDY =
    "Add your own provider key in Settings → Bring Your Own Keys to keep working, or ask your administrator to raise the limit.";
const ORGANIZATION_KEY_REMEDY =
    "An organization admin can add the organization's own key in its Bring Your Own Keys settings, or ask your administrator to raise the limit.";

const QUOTA_MESSAGES = {
    personal: {
        workspace: `You have reached this month's limit for AI use on this deployment's provider keys. ${OWN_KEY_REMEDY}`,
        person: `You have reached this month's limit for AI use on this deployment's provider keys, counted across all your workspaces. ${OWN_KEY_REMEDY}`,
    },
    organization: {
        workspace: `This organization has reached this month's limit for AI use on this deployment's provider keys. ${ORGANIZATION_KEY_REMEDY}`,
        person: `You have reached this month's limit for AI use on this deployment's provider keys, counted across all your workspaces. ${ORGANIZATION_KEY_REMEDY}`,
    },
} as const;

/** What an allowance limits: one workspace's total, or one person's across every workspace. */
export type AllowanceScope = "workspace" | "person";

/**
 * A call that would run on the deployment's keys was refused because its
 * workspace, or the person it is for, has used this month's allowance.
 * Written for the user: the chat surfaces show it as it is, and HTTP routes
 * answer 403 with its code.
 */
export class DeploymentQuotaExceededError extends UserFacingError {
    readonly code = DEPLOYMENT_QUOTA_EXCEEDED_CODE;

    constructor(
        workspace: "personal" | "organization",
        readonly reached: AllowanceScope = "workspace",
    ) {
        super(QUOTA_MESSAGES[workspace][reached]);
        this.name = "DeploymentQuotaExceededError";
    }
}

/** The quota refusal, when `error` is one or was caused by one. */
export function deploymentQuotaError(
    error: unknown,
): DeploymentQuotaExceededError | null {
    let current = error;
    const seen = new Set<unknown>();
    for (let depth = 0; depth < 8 && current && !seen.has(current); depth++) {
        if (current instanceof DeploymentQuotaExceededError) return current;
        seen.add(current);
        current =
            typeof current === "object"
                ? (current as { cause?: unknown }).cause
                : undefined;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the uuid columns accept, or null: a malformed id must not cost the row. */
function uuidOrNull(value: string | null | undefined): string | null {
    return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function tokenCount(value: number | undefined): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : 0;
}

function pageCount(value: number | null | undefined): number | null {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 2_147_483_647
        ? value
        : null;
}

/** The usage_events row for one call. A null org_id is the person's own workspace. */
export function usageEventRow(call: ModelCall, context: UsageContext) {
    return {
        org_id: uuidOrNull(context.orgId),
        user_id: uuidOrNull(context.userId),
        project_id: uuidOrNull(context.projectId),
        surface: context.surface,
        model: (call.model || "unknown").slice(0, 200),
        provider: (call.provider || "unknown").slice(0, 50),
        key_source: call.keySource,
        input_tokens: tokenCount(call.usage.inputTokens),
        output_tokens: tokenCount(call.usage.outputTokens),
        cached_tokens: tokenCount(call.usage.cachedTokens),
        document_pages: pageCount(context.documentPages),
        tokens_estimated: call.estimated === true,
        chat_id: uuidOrNull(context.chatId),
        review_id: uuidOrNull(context.reviewId),
        run_id: uuidOrNull(context.runId),
        document_id: uuidOrNull(context.documentId),
    };
}

/** Ledger writes still in flight; see settleUsageWrites. */
const pendingWrites = new Set<Promise<void>>();

// Codes for "this database has not run the usage_events migration yet"
// (deploy before migrate): a direct connection's 42P01/42883, PostgREST's
// schema-cache misses. Reported once per process rather than on every call.
const MISSING_SCHEMA_CODES = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const reportedOnce = new Set<string>();

function isMissingSchema(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" && MISSING_SCHEMA_CODES.has(code);
}

function reportLedgerFailure(
    kind: "usage.write_failed" | "usage.read_failed",
    message: string,
    error: unknown,
): void {
    if (isMissingSchema(error)) {
        if (reportedOnce.has(kind)) return;
        reportedOnce.add(kind);
    }
    const failure = new AppError(kind, message, { cause: error });
    reportError(failure, {
        level: "warning",
        tags: { component: "usage-ledger" },
    });
    // warn, not error: the report above is the event.
    console.warn(`[usage] ${message}`, failure);
}

/**
 * Record one model call in the ledger, attributed to `context` (by default
 * the one the current work runs in). Without a context there is nobody to
 * attribute the call to, and nothing is written. Never throws and never
 * rejects: a failed write is reported, not raised.
 */
export function recordUsage(
    call: ModelCall,
    context: UsageContext | undefined = currentUsageContext(),
): Promise<void> {
    if (!context) return Promise.resolve();
    if (call.keySource === "env") {
        countDeploymentTokens(
            context,
            tokenCount(call.usage.inputTokens) + tokenCount(call.usage.outputTokens),
        );
    }
    const write = (async () => {
        try {
            const { error } = await createServerSupabase()
                .from("usage_events")
                .insert(usageEventRow(call, context));
            if (error) throw error;
        } catch (error) {
            reportLedgerFailure(
                "usage.write_failed",
                "A usage ledger row could not be written",
                error,
            );
        }
    })().catch(() => {
        // Not even a failure to report it may reach the call.
    });
    pendingWrites.add(write);
    void write.finally(() => pendingWrites.delete(write));
    return write;
}

/** Wait for every ledger write started so far (tests, orderly shutdown). */
export async function settleUsageWrites(): Promise<void> {
    while (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
}

// ---------------------------------------------------------------------------
// The monthly cap on the deployment's keys
// ---------------------------------------------------------------------------

const CAP_VARIABLE = "DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP";

/**
 * The monthly cap, in input plus output tokens per workspace and per person,
 * or null when unset (no cap). A value that is not a whole number of tokens
 * counts as 0, so a mistyped cap blocks deployment-key use instead of
 * lifting the limit; the server log names the variable.
 */
export function deploymentKeyMonthlyTokenCap(
    env: NodeJS.ProcessEnv = process.env,
): number | null {
    const raw = env[CAP_VARIABLE]?.trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) {
        return Number(raw);
    }
    if (!reportedOnce.has(CAP_VARIABLE)) {
        reportedOnce.add(CAP_VARIABLE);
        console.warn(
            `[usage] ${CAP_VARIABLE} is not a whole number of tokens; calls on the deployment's keys are refused until it is corrected or removed.`,
        );
    }
    return 0;
}

/**
 * How many tokens may be used on the deployment's keys this month, or null
 * for no limit: by the workspace `context` belongs to (`scope` "workspace"),
 * or by its person across every workspace (`scope` "person"). The default
 * reads DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP for both; plans (when enabled)
 * supply their own allowances here, through the same check.
 */
export type DeploymentAllowance = (
    context: UsageContext,
    scope: AllowanceScope,
) => number | null | Promise<number | null>;

const environmentAllowance: DeploymentAllowance = () =>
    deploymentKeyMonthlyTokenCap();

let allowance: DeploymentAllowance = environmentAllowance;

/** Replace the allowance source; null restores the environment cap. */
export function setDeploymentAllowance(
    source: DeploymentAllowance | null,
): void {
    allowance = source ?? environmentAllowance;
}

// ---------------------------------------------------------------------------
// This month's deployment-key totals
// ---------------------------------------------------------------------------

/**
 * How long, in milliseconds, a total read from the ledger stands in for the
 * ledger in this process. The calls this process records are added to it as
 * they finish; calls made by other processes count once it is read again.
 */
export const DEPLOYMENT_TOTALS_TTL_MS = 30_000;
const MAX_CACHED_TOTALS = 10_000;

/** Input plus output tokens on the deployment's keys this month. */
export type DeploymentKeyTokens = {
    /** The workspace's, from every member. */
    workspace: number;
    /** The person's, from every workspace. */
    person: number;
    /** Whether the workspace is a person's own (Personal) one. */
    personalWorkspace: boolean;
};

type CachedTotal = {
    month: string;
    tokens: number;
    readAt: number;
    personal?: boolean;
};

const workspaceTotals = new Map<string, CachedTotal>();
const personTotals = new Map<string, CachedTotal>();

/** Forget every cached total (tests). */
export function resetDeploymentTotalsForTests(): void {
    workspaceTotals.clear();
    personTotals.clear();
}

function monthOf(now: Date): string {
    return now.toISOString().slice(0, 7);
}

function workspaceKey(context: UsageContext): string | null {
    const org = uuidOrNull(context.orgId);
    if (org) return `org:${org}`;
    const user = uuidOrNull(context.userId);
    return user ? `personal:${user}` : null;
}

function personKey(context: UsageContext): string | null {
    return uuidOrNull(context.userId);
}

function cachedTotal(
    totals: Map<string, CachedTotal>,
    key: string | null,
    now: Date,
): CachedTotal | null {
    const entry = key ? totals.get(key) : undefined;
    return entry &&
        entry.month === monthOf(now) &&
        now.getTime() - entry.readAt < DEPLOYMENT_TOTALS_TTL_MS
        ? entry
        : null;
}

function rememberTotal(
    totals: Map<string, CachedTotal>,
    key: string | null,
    entry: CachedTotal,
): void {
    if (!key) return;
    totals.delete(key);
    if (totals.size >= MAX_CACHED_TOTALS) {
        const oldest = totals.keys().next();
        if (!oldest.done) totals.delete(oldest.value);
    }
    totals.set(key, entry);
}

/** Add a call this process just recorded to the totals it holds. */
function countDeploymentTokens(context: UsageContext, tokens: number): void {
    if (tokens <= 0) return;
    const month = monthOf(new Date());
    const entries = [
        workspaceTotals.get(workspaceKey(context) ?? ""),
        personTotals.get(personKey(context) ?? ""),
    ];
    for (const entry of entries) {
        if (entry && entry.month === month) entry.tokens += tokens;
    }
}

function tokenTotal(value: unknown): number {
    const total = Number(value ?? 0);
    return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Tokens (input plus output) used on the deployment's keys in the current
 * calendar month (UTC): by the workspace `context` belongs to, and by its
 * person across every workspace. Read from the ledger, or from this
 * process's totals while they are fresh.
 */
export async function deploymentTokensThisMonth(
    context: UsageContext,
    now: Date = new Date(),
    options: { fresh?: boolean } = {},
): Promise<DeploymentKeyTokens> {
    const workspace = workspaceKey(context);
    const person = personKey(context);
    const workspaceEntry = options.fresh
        ? null
        : cachedTotal(workspaceTotals, workspace, now);
    const personEntry = options.fresh
        ? null
        : cachedTotal(personTotals, person, now);
    if (workspaceEntry && personEntry) {
        return {
            workspace: workspaceEntry.tokens,
            person: personEntry.tokens,
            personalWorkspace: workspaceEntry.personal === true,
        };
    }
    const orgId = uuidOrNull(context.orgId);
    const { data, error } = await createServerSupabase().rpc(
        "usage_deployment_key_tokens",
        {
            p_org_id: orgId,
            p_user_id: uuidOrNull(context.userId),
            p_month: now.toISOString(),
        },
    );
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
        | Record<string, unknown>
        | null
        | undefined;
    const totals: DeploymentKeyTokens = {
        workspace: tokenTotal(row?.workspace_tokens),
        person: tokenTotal(row?.person_tokens),
        personalWorkspace: !orgId || row?.workspace_personal === true,
    };
    const month = monthOf(now);
    const readAt = now.getTime();
    rememberTotal(workspaceTotals, workspace, {
        month,
        tokens: totals.workspace,
        readAt,
        personal: totals.personalWorkspace,
    });
    rememberTotal(personTotals, person, { month, tokens: totals.person, readAt });
    return totals;
}

/**
 * Refuse a call that would run on the deployment's keys once its workspace,
 * or its person across every workspace, has used this month's allowance.
 * Calls on a person's or organization's own key, and every call while no
 * allowance is configured, pass untouched.
 *
 * An allowance or a ledger that cannot be read does not stop the call: the
 * failure is reported, and the answer is worth more than the check.
 * `fresh` reads the ledger even while this process holds recent totals.
 */
export async function assertDeploymentKeyAllowance(
    keySource: KeySource | undefined,
    context: UsageContext | undefined = currentUsageContext(),
    options: { fresh?: boolean } = {},
): Promise<void> {
    if (keySource !== "env") return;
    if (!context) {
        // Only matters while a cap is set: report the uncovered entry point.
        if (deploymentKeyMonthlyTokenCap() !== null && !reportedOnce.has("context")) {
            reportedOnce.add("context");
            reportError(
                new AppError(
                    "usage.context_missing",
                    "A model call on a deployment key ran without a usage context",
                ),
                { level: "warning", tags: { component: "usage-ledger" } },
            );
            console.warn(
                "[usage] a model call on a deployment key ran without a usage context; it is neither recorded nor capped",
            );
        }
        return;
    }
    let limits: Record<AllowanceScope, number | null>;
    let used: DeploymentKeyTokens;
    try {
        const [workspace, person] = await Promise.all([
            allowance(context, "workspace"),
            allowance(context, "person"),
        ]);
        if (workspace === null && person === null) return;
        limits = { workspace, person };
        used = await deploymentTokensThisMonth(context, new Date(), options);
    } catch (error) {
        reportLedgerFailure(
            "usage.read_failed",
            "This month's deployment-key allowance could not be checked",
            error,
        );
        return;
    }
    const where = used.personalWorkspace ? "personal" : "organization";
    if (limits.workspace !== null && used.workspace >= limits.workspace) {
        throw new DeploymentQuotaExceededError(where, "workspace");
    }
    if (limits.person !== null && used.person >= limits.person) {
        throw new DeploymentQuotaExceededError(where, "person");
    }
}
