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
// DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP set, a workspace (an organization, or a
// person's Personal workspace) whose deployment-key tokens this calendar
// month (UTC) have reached the cap is refused before any provider call.
// Keys a person or an organization saved are recorded but never capped.
// Unset, nothing is capped, as before the ledger existed.

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
};

export const DEPLOYMENT_QUOTA_EXCEEDED_CODE = "deployment_quota_exceeded";

const PERSONAL_QUOTA_MESSAGE =
    "You have reached this month's limit for AI use on this deployment's provider keys. Add your own provider key in Settings → Bring Your Own Keys to keep working, or ask your administrator to raise the limit.";
const ORGANIZATION_QUOTA_MESSAGE =
    "This organization has reached this month's limit for AI use on this deployment's provider keys. An organization admin can add the organization's own key in its Bring Your Own Keys settings, or ask your administrator to raise the limit.";

/**
 * A call that would run on the deployment's keys was refused because its
 * workspace has used this month's allowance. Written for the user: the chat
 * surfaces show it as it is, and HTTP routes answer 403 with its code.
 */
export class DeploymentQuotaExceededError extends UserFacingError {
    readonly code = DEPLOYMENT_QUOTA_EXCEEDED_CODE;

    constructor(workspace: "personal" | "organization") {
        super(
            workspace === "organization"
                ? ORGANIZATION_QUOTA_MESSAGE
                : PERSONAL_QUOTA_MESSAGE,
        );
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
 * The monthly cap, in input plus output tokens per workspace, or null when
 * unset (no cap). A value that is not a whole number of tokens counts as 0,
 * so a mistyped cap blocks deployment-key use instead of lifting the limit;
 * the server log names the variable.
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
 * How many tokens a workspace may use on the deployment's keys this month,
 * or null for no limit. The default reads DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP
 * for every workspace; plans (when enabled) supply per-workspace allowances
 * here, through the same check.
 */
export type DeploymentAllowance = (
    context: UsageContext,
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

/**
 * Tokens (input plus output) the workspace `context` belongs to has used on
 * the deployment's keys in the current calendar month (UTC).
 */
export async function deploymentTokensThisMonth(
    context: UsageContext,
    now: Date = new Date(),
): Promise<number> {
    const { data, error } = await createServerSupabase().rpc(
        "usage_monthly_rollup",
        {
            p_org_id: uuidOrNull(context.orgId),
            p_user_id: uuidOrNull(context.userId),
            p_month: now.toISOString(),
        },
    );
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => row.key_source === "env")
        .reduce(
            (sum, row) =>
                sum + Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0),
            0,
        );
}

/**
 * Refuse a call that would run on the deployment's keys once its workspace
 * has used this month's allowance. Calls on a person's or organization's
 * own key, and every call while no allowance is configured, pass untouched.
 *
 * An allowance or a ledger that cannot be read does not stop the call: the
 * failure is reported, and the answer is worth more than the check.
 */
export async function assertDeploymentKeyAllowance(
    keySource: KeySource | undefined,
    context: UsageContext | undefined = currentUsageContext(),
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
    let limit: number | null;
    let used: number;
    try {
        limit = await allowance(context);
        if (limit === null) return;
        used = await deploymentTokensThisMonth(context);
    } catch (error) {
        reportLedgerFailure(
            "usage.read_failed",
            "This month's deployment-key allowance could not be checked",
            error,
        );
        return;
    }
    if (used >= limit) {
        throw new DeploymentQuotaExceededError(
            context.orgId ? "organization" : "personal",
        );
    }
}
