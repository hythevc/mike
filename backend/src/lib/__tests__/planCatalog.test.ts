// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
    PlanCatalogError,
    parsePlanCatalog,
    planByKey,
    plansEnabled,
    publicPlans,
    loadPlanCatalog,
} from "../planCatalog";

const VALID = JSON.stringify([
    {
        key: "byok",
        name: "Bring your own key",
        description: "Use your own provider key.",
        seat_limit: 5,
        features: ["Your key", "All workflows"],
        deployment_token_allowance: null,
        trial_days: 14,
        public: true,
        sort_order: 1,
        display_price_text: "$0",
        provider_price_ref: "price_byok_secret",
    },
    {
        key: "included",
        name: "Included AI",
        description: "A pooled page allowance.",
        seat_limit: 25,
        features: ["Pooled pages"],
        deployment_token_allowance: 1000000,
        trial_days: 14,
        public: true,
        sort_order: 2,
        display_price_text: "$199",
        provider_price_ref: "price_included_secret",
    },
    {
        key: "internal",
        name: "Internal",
        description: "Not shown to buyers.",
        features: [],
        public: false,
        sort_order: 99,
        display_price_text: "",
    },
]);

describe("plansEnabled", () => {
    it("is off unless explicitly true", () => {
        expect(plansEnabled({})).toBe(false);
        expect(plansEnabled({ PLANS_ENABLED: "false" })).toBe(false);
        expect(plansEnabled({ PLANS_ENABLED: "1" })).toBe(false);
        expect(plansEnabled({ PLANS_ENABLED: "true" })).toBe(true);
        expect(plansEnabled({ PLANS_ENABLED: " TRUE " })).toBe(true);
    });
});

describe("parsePlanCatalog", () => {
    it("treats an empty or missing value as no plans", () => {
        expect(parsePlanCatalog(undefined)).toEqual([]);
        expect(parsePlanCatalog("")).toEqual([]);
        expect(parsePlanCatalog("   ")).toEqual([]);
    });

    it("parses a valid catalog into typed plans", () => {
        const plans = parsePlanCatalog(VALID);
        expect(plans).toHaveLength(3);
        const byok = plans[0];
        expect(byok.key).toBe("byok");
        expect(byok.seatLimit).toBe(5);
        expect(byok.deploymentTokenAllowance).toBeNull();
        expect(byok.trialDays).toBe(14);
        expect(byok.providerPriceRef).toBe("price_byok_secret");
        expect(plans[2].public).toBe(false);
        // Missing optional fields default without error.
        expect(plans[2].seatLimit).toBeNull();
        expect(plans[2].deploymentTokenAllowance).toBeNull();
    });

    it("rejects non-JSON, naming the variable", () => {
        expect(() => parsePlanCatalog("{not json")).toThrow(PlanCatalogError);
        expect(() => parsePlanCatalog("{not json")).toThrow(
            /PLANS_CATALOG_JSON is not valid JSON/,
        );
    });

    it("rejects a non-array catalog", () => {
        expect(() => parsePlanCatalog('{"key":"x"}')).toThrow(
            /must be a JSON array/,
        );
    });

    it.each([
        [[{ name: "No key", description: "" }], /field "key"/],
        [[{ key: "bad key!", name: "x", description: "" }], /field "key"/],
        [
            [
                { key: "dup", name: "a", description: "" },
                { key: "dup", name: "b", description: "" },
            ],
            /field "key".*duplicate/,
        ],
        [[{ key: "k", description: "" }], /field "name"/],
        [
            [{ key: "k", name: "n", description: "", seat_limit: 0 }],
            /field "seat_limit"/,
        ],
        [
            [{ key: "k", name: "n", description: "", seat_limit: 1.5 }],
            /field "seat_limit"/,
        ],
        [
            [
                {
                    key: "k",
                    name: "n",
                    description: "",
                    deployment_token_allowance: -1,
                },
            ],
            /field "deployment_token_allowance"/,
        ],
        [
            [{ key: "k", name: "n", description: "", features: "x" }],
            /field "features"/,
        ],
        [
            [{ key: "k", name: "n", description: "", public: "yes" }],
            /field "public"/,
        ],
        [
            [{ key: "k", name: "n", description: "", sort_order: "first" }],
            /field "sort_order"/,
        ],
    ])("names the field at fault (%#)", (catalog, pattern) => {
        expect(() => parsePlanCatalog(JSON.stringify(catalog))).toThrow(pattern);
    });
});

describe("publicPlans", () => {
    const env = { PLANS_CATALOG_JSON: VALID };

    it("returns only public plans, in sort order, with no provider reference", () => {
        const plans = publicPlans(env);
        expect(plans.map((plan) => plan.key)).toEqual(["byok", "included"]);
        for (const plan of plans) {
            expect(Object.keys(plan)).not.toContain("providerPriceRef");
            expect(JSON.stringify(plan)).not.toContain("secret");
        }
    });

    it("is empty when no catalog is configured", () => {
        expect(publicPlans({})).toEqual([]);
    });
});

describe("planByKey and loadPlanCatalog", () => {
    const env = { PLANS_CATALOG_JSON: VALID };
    it("finds a plan, including a private one", () => {
        expect(planByKey("included", env)?.name).toBe("Included AI");
        expect(planByKey("internal", env)?.public).toBe(false);
        expect(planByKey("missing", env)).toBeNull();
        expect(planByKey(null, env)).toBeNull();
    });
    it("loads from the environment", () => {
        expect(loadPlanCatalog(env)).toHaveLength(3);
        expect(loadPlanCatalog({})).toEqual([]);
    });
});
