// SPDX-License-Identifier: AGPL-3.0-only
//
// The plan catalog: the plans a deployment offers, read from the
// PLANS_CATALOG_JSON environment variable and validated at load. No plans and
// no prices are committed to this repository; a deployment that offers plans
// supplies its own catalog, and one that does not (every self-hosted install
// by default) supplies none and sees no change.
//
// A plan names a tier, a seat limit, a monthly allowance on the deployment's
// own AI keys, a trial length and the copy shown to a buyer. `provider_price_ref`
// points at the billing provider's price and is never returned to a browser.
//
// Plans are inert unless the backend runs with PLANS_ENABLED set; see
// entitlements.ts. Billing is a separate switch again (BILLING_ENABLED), off
// by default, and nothing here charges anyone.

/** A plan as it is stored and used inside the backend. */
export type Plan = {
    key: string;
    name: string;
    description: string;
    /** Seats the plan includes, or null for no seat limit. */
    seatLimit: number | null;
    /** Short feature lines shown on the plan. */
    features: string[];
    /**
     * Tokens (input plus output) a workspace on this plan may use on the
     * deployment's own AI keys each month, or null for the deployment default.
     */
    deploymentTokenAllowance: number | null;
    /** Days a new workspace trials the plan, or null for none. */
    trialDays: number | null;
    /** Whether the plan is shown to buyers (GET /plans) or internal only. */
    public: boolean;
    /** Where the plan sorts among the others; lower comes first. */
    sortOrder: number;
    /** The price as shown to a buyer, for example "$99 per user / month". */
    displayPriceText: string;
    /** The billing provider's price id. Never returned to a browser. */
    providerPriceRef: string | null;
};

/** A plan as returned to a browser: everything but the provider reference. */
export type PublicPlan = Omit<Plan, "providerPriceRef">;

const CATALOG_VARIABLE = "PLANS_CATALOG_JSON";
const PLANS_ENABLED_VARIABLE = "PLANS_ENABLED";

/** Whether plans are enforced on this deployment. Off unless explicitly set. */
export function plansEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[PLANS_ENABLED_VARIABLE]?.trim().toLowerCase() === "true";
}

/** A catalog that does not parse or does not validate, naming the problem. */
export class PlanCatalogError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlanCatalogError";
    }
}

function fieldError(index: number, field: string, problem: string): never {
    throw new PlanCatalogError(
        `${CATALOG_VARIABLE}: plan at index ${index}: field "${field}" ${problem}`,
    );
}

function requireString(
    value: unknown,
    index: number,
    field: string,
    { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
    if (typeof value !== "string") fieldError(index, field, "must be a string");
    if (!allowEmpty && value.trim() === "")
        fieldError(index, field, "must not be empty");
    return value;
}

function optionalNonNegativeInt(
    value: unknown,
    index: number,
    field: string,
    { min = 0 }: { min?: number } = {},
): number | null {
    if (value === null || value === undefined) return null;
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < min
    )
        fieldError(
            index,
            field,
            `must be a whole number of at least ${min}, or null`,
        );
    return value;
}

/**
 * Parse and validate a plan catalog, throwing a PlanCatalogError that names
 * the first field at fault. The input is the raw JSON; an empty or missing
 * value is an empty catalog, not an error.
 */
export function parsePlanCatalog(raw: string | undefined | null): Plan[] {
    const text = raw?.trim();
    if (!text) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new PlanCatalogError(
            `${CATALOG_VARIABLE} is not valid JSON: ${
                error instanceof Error ? error.message : "parse error"
            }`,
        );
    }
    if (!Array.isArray(parsed))
        throw new PlanCatalogError(`${CATALOG_VARIABLE} must be a JSON array of plans`);

    const keys = new Set<string>();
    const plans = parsed.map((entry, index): Plan => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
            throw new PlanCatalogError(
                `${CATALOG_VARIABLE}: plan at index ${index} must be an object`,
            );
        const row = entry as Record<string, unknown>;

        const key = requireString(row.key, index, "key");
        if (!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(key))
            fieldError(
                index,
                "key",
                "must be 1-100 letters, digits, hyphens or underscores",
            );
        if (keys.has(key)) fieldError(index, "key", `is a duplicate ("${key}")`);
        keys.add(key);

        const features = row.features ?? [];
        if (
            !Array.isArray(features) ||
            features.some((feature) => typeof feature !== "string")
        )
            fieldError(index, "features", "must be an array of strings");

        if (row.public !== undefined && typeof row.public !== "boolean")
            fieldError(index, "public", "must be true or false");

        const sortOrder = row.sort_order ?? 0;
        if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder))
            fieldError(index, "sort_order", "must be a number");

        if (
            row.provider_price_ref !== undefined &&
            row.provider_price_ref !== null &&
            typeof row.provider_price_ref !== "string"
        )
            fieldError(index, "provider_price_ref", "must be a string or null");

        return {
            key,
            name: requireString(row.name, index, "name"),
            description: requireString(row.description ?? "", index, "description", {
                allowEmpty: true,
            }),
            seatLimit: optionalNonNegativeInt(row.seat_limit, index, "seat_limit", {
                min: 1,
            }),
            features: features as string[],
            deploymentTokenAllowance: optionalNonNegativeInt(
                row.deployment_token_allowance,
                index,
                "deployment_token_allowance",
            ),
            trialDays: optionalNonNegativeInt(row.trial_days, index, "trial_days"),
            public: row.public === undefined ? true : (row.public as boolean),
            sortOrder,
            displayPriceText: requireString(
                row.display_price_text ?? "",
                index,
                "display_price_text",
                { allowEmpty: true },
            ),
            providerPriceRef:
                typeof row.provider_price_ref === "string"
                    ? row.provider_price_ref
                    : null,
        };
    });

    return plans;
}

/** The deployment's plan catalog, parsed from the environment. Throws on a bad catalog. */
export function loadPlanCatalog(env: NodeJS.ProcessEnv = process.env): Plan[] {
    return parsePlanCatalog(env[CATALOG_VARIABLE]);
}

/** The plan with this key, or null. */
export function planByKey(
    key: string | null | undefined,
    env: NodeJS.ProcessEnv = process.env,
): Plan | null {
    if (!key) return null;
    return loadPlanCatalog(env).find((plan) => plan.key === key) ?? null;
}

/** The public plans, without provider references, in display order. */
export function publicPlans(env: NodeJS.ProcessEnv = process.env): PublicPlan[] {
    return loadPlanCatalog(env)
        .filter((plan) => plan.public)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
        .map(toPublicPlan);
}

/** Drop the provider reference so a plan is safe to return to a browser. */
export function toPublicPlan(plan: Plan): PublicPlan {
    const { providerPriceRef: _ignored, ...rest } = plan;
    void _ignored;
    return rest;
}
