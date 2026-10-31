// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { control, inserts, rpcCalls, reportError } = vi.hoisted(() => ({
    control: {
        insertError: null as { code?: string; message: string } | null,
        rollup: [] as Array<Record<string, unknown>>,
        rollupError: null as { code?: string; message: string } | null,
        clientThrows: false,
    },
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    reportError: vi.fn(),
}));

vi.mock("../supabase", () => ({
    createServerSupabase: () => {
        if (control.clientThrows) {
            throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
        }
        return {
            from: (table: string) => ({
                insert: async (row: Record<string, unknown>) => {
                    inserts.push({ table, row });
                    return { error: control.insertError };
                },
            }),
            rpc: async (name: string, args: Record<string, unknown>) => {
                rpcCalls.push({ name, args });
                return control.rollupError
                    ? { data: null, error: control.rollupError }
                    : { data: control.rollup, error: null };
            },
        };
    },
}));
vi.mock("../observability/sentry", () => ({ reportError }));

import type { UsageContext } from "../llm/usageContext";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const CHAT = "00000000-0000-4000-8000-000000000030";

const chat: UsageContext = {
    userId: USER,
    orgId: null,
    projectId: PROJECT,
    surface: "chat",
    chatId: CHAT,
};

const call = {
    model: "claude-haiku-4-5",
    provider: "claude",
    keySource: "env" as const,
    usage: { inputTokens: 1200, outputTokens: 300, cachedTokens: 1000 },
};

/**
 * A fresh copy of the module, so its once-per-process reports start over,
 * with the context store of the same module graph.
 */
async function loadUsage() {
    vi.resetModules();
    const { runWithUsageContext } = await import("../llm/usageContext.js");
    return { ...(await import("../usage.js")), runWithUsageContext };
}

beforeEach(() => {
    control.insertError = null;
    control.rollup = [];
    control.rollupError = null;
    control.clientThrows = false;
    inserts.length = 0;
    rpcCalls.length = 0;
    reportError.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("recordUsage", () => {
    it("writes one row under the current context", async () => {
        const { recordUsage, settleUsageWrites, runWithUsageContext } =
            await loadUsage();
        await runWithUsageContext(chat, () => recordUsage(call));
        await settleUsageWrites();
        expect(inserts).toEqual([
            {
                table: "usage_events",
                row: {
                    org_id: null,
                    user_id: USER,
                    project_id: PROJECT,
                    surface: "chat",
                    model: "claude-haiku-4-5",
                    provider: "claude",
                    key_source: "env",
                    input_tokens: 1200,
                    output_tokens: 300,
                    cached_tokens: 1000,
                    document_pages: null,
                    chat_id: CHAT,
                    review_id: null,
                    run_id: null,
                    document_id: null,
                },
            },
        ]);
    });

    it("drops malformed ids and counts instead of losing the row", async () => {
        const { recordUsage } = await loadUsage();
        await recordUsage(
            {
                ...call,
                usage: { inputTokens: -5, outputTokens: 2.5, cachedTokens: Number.NaN },
            },
            { ...chat, chatId: "chat-1", runId: "not-a-uuid", documentPages: -1 },
        );
        expect(inserts[0].row).toMatchObject({
            chat_id: null,
            run_id: null,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            document_pages: null,
        });
    });

    it("writes nothing outside a usage context", async () => {
        const { recordUsage } = await loadUsage();
        await recordUsage(call);
        expect(inserts).toEqual([]);
    });

    it("never rejects when the write fails, and reports it", async () => {
        const { recordUsage } = await loadUsage();
        control.insertError = { code: "23503", message: "violates foreign key" };
        await expect(recordUsage(call, chat)).resolves.toBeUndefined();
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError.mock.calls[0][0]).toMatchObject({ kind: "usage.write_failed" });
    });

    it("never rejects when there is no database client", async () => {
        const { recordUsage } = await loadUsage();
        control.clientThrows = true;
        await expect(recordUsage(call, chat)).resolves.toBeUndefined();
        expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("reports a database without the ledger once, not on every call", async () => {
        const { recordUsage } = await loadUsage();
        control.insertError = { code: "PGRST205", message: "relation not found" };
        await recordUsage(call, chat);
        await recordUsage(call, chat);
        expect(reportError).toHaveBeenCalledTimes(1);
    });
});

describe("deploymentKeyMonthlyTokenCap", () => {
    it("is unset unless the variable has a value", async () => {
        const { deploymentKeyMonthlyTokenCap } = await loadUsage();
        expect(deploymentKeyMonthlyTokenCap({})).toBeNull();
        expect(deploymentKeyMonthlyTokenCap({ DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: " " })).toBeNull();
        expect(deploymentKeyMonthlyTokenCap({ DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: "250000" })).toBe(250_000);
        expect(deploymentKeyMonthlyTokenCap({ DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: "0" })).toBe(0);
    });

    it("counts a value that is not a whole number as 0 and names the variable", async () => {
        const { deploymentKeyMonthlyTokenCap } = await loadUsage();
        expect(deploymentKeyMonthlyTokenCap({ DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: "5M" })).toBe(0);
        expect(deploymentKeyMonthlyTokenCap({ DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: "-1" })).toBe(0);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain(
            "DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP",
        );
    });
});

describe("assertDeploymentKeyAllowance", () => {
    const overCap = [
        { key_source: "env", input_tokens: 600, output_tokens: 400 },
        { key_source: "user", input_tokens: 50_000, output_tokens: 1 },
    ];

    it("reads this month's rollup for the workspace", async () => {
        const { deploymentTokensThisMonth } = await loadUsage();
        control.rollup = overCap;
        const now = new Date("2026-10-31T12:00:00Z");
        await expect(deploymentTokensThisMonth(chat, now)).resolves.toBe(1000);
        expect(rpcCalls).toEqual([
            {
                name: "usage_monthly_rollup",
                args: { p_org_id: null, p_user_id: USER, p_month: now.toISOString() },
            },
        ]);
    });

    it("refuses a deployment-key call once the Personal workspace reaches the cap", async () => {
        const { assertDeploymentKeyAllowance, DEPLOYMENT_QUOTA_EXCEEDED_CODE } =
            await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1000");
        control.rollup = overCap;
        const refusal = await assertDeploymentKeyAllowance("env", chat).catch(
            (error: unknown) => error,
        );
        expect(refusal).toMatchObject({
            name: "DeploymentQuotaExceededError",
            code: DEPLOYMENT_QUOTA_EXCEEDED_CODE,
        });
        expect((refusal as Error).message).toContain("Add your own provider key");
    });

    it("names the organization when an organization reaches the cap", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1000");
        control.rollup = overCap;
        await expect(
            assertDeploymentKeyAllowance("env", { ...chat, orgId: ORG }),
        ).rejects.toThrow(/This organization has reached/);
        expect(rpcCalls[0].args).toMatchObject({ p_org_id: ORG });
    });

    it("lets calls through below the cap, counting only deployment-key tokens", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1001");
        control.rollup = overCap;
        await expect(assertDeploymentKeyAllowance("env", chat)).resolves.toBeUndefined();
    });

    it("never caps or reads the ledger for a person's or organization's own key", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "0");
        control.rollup = overCap;
        await expect(assertDeploymentKeyAllowance("user", chat)).resolves.toBeUndefined();
        await expect(assertDeploymentKeyAllowance("org", chat)).resolves.toBeUndefined();
        expect(rpcCalls).toEqual([]);
    });

    it("blocks nothing and reads nothing when no cap is configured", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        control.rollup = overCap;
        await expect(assertDeploymentKeyAllowance("env", chat)).resolves.toBeUndefined();
        expect(rpcCalls).toEqual([]);
    });

    it("lets the call through when the ledger cannot be read, and reports it", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1");
        control.rollupError = { code: "57014", message: "statement timeout" };
        await expect(assertDeploymentKeyAllowance("env", chat)).resolves.toBeUndefined();
        expect(reportError.mock.calls[0][0]).toMatchObject({ kind: "usage.read_failed" });
    });

    it("reports, once, a deployment-key call made without a context while a cap is set", async () => {
        const { assertDeploymentKeyAllowance } = await loadUsage();
        vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1");
        await expect(assertDeploymentKeyAllowance("env")).resolves.toBeUndefined();
        await expect(assertDeploymentKeyAllowance("env")).resolves.toBeUndefined();
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError.mock.calls[0][0]).toMatchObject({ kind: "usage.context_missing" });
        expect(rpcCalls).toEqual([]);
    });

    it("takes a supplied allowance through the same check", async () => {
        const { assertDeploymentKeyAllowance, setDeploymentAllowance } = await loadUsage();
        control.rollup = overCap;
        setDeploymentAllowance(async (context) => (context.orgId ? null : 999));
        try {
            await expect(assertDeploymentKeyAllowance("env", chat)).rejects.toThrow();
            await expect(
                assertDeploymentKeyAllowance("env", { ...chat, orgId: ORG }),
            ).resolves.toBeUndefined();
        } finally {
            setDeploymentAllowance(null);
        }
        await expect(assertDeploymentKeyAllowance("env", chat)).resolves.toBeUndefined();
    });

    it("lets the call through, and reports it, when the allowance cannot be read", async () => {
        const { assertDeploymentKeyAllowance, setDeploymentAllowance } = await loadUsage();
        setDeploymentAllowance(async () => {
            throw new Error("plans unavailable");
        });
        try {
            await expect(assertDeploymentKeyAllowance("env", chat)).resolves.toBeUndefined();
        } finally {
            setDeploymentAllowance(null);
        }
        expect(reportError.mock.calls[0][0]).toMatchObject({ kind: "usage.read_failed" });
        expect(rpcCalls).toEqual([]);
    });

    it("finds the refusal under wrappers", async () => {
        const { DeploymentQuotaExceededError, deploymentQuotaError } = await loadUsage();
        const refusal = new DeploymentQuotaExceededError("personal");
        expect(deploymentQuotaError(new Error("wrapped", { cause: refusal }))).toBe(refusal);
        expect(deploymentQuotaError(new Error("other"))).toBeNull();
        expect(deploymentQuotaError(null)).toBeNull();
    });
});

describe("the ledger's vocabulary", () => {
    it("matches the usage_events check constraints in schema.sql", async () => {
        const { readFileSync } = await import("node:fs");
        const path = await import("node:path");
        const { USAGE_SURFACES } = await import("../llm/usageContext.js");
        const schema = readFileSync(
            path.resolve(__dirname, "../../../schema.sql"),
            "utf8",
        );
        const allowed = (constraint: string) =>
            [
                ...(schema
                    .match(new RegExp(`constraint ${constraint}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`))?.[1]
                    ?.matchAll(/'([a-z_]+)'/g) ?? []),
            ].map((match) => match[1]);
        expect(allowed("usage_events_surface_check")).toEqual([...USAGE_SURFACES]);
        expect(allowed("usage_events_key_source_check")).toEqual(["user", "org", "env"]);
    });
});
