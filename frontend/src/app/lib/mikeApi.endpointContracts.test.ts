// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    createOrgCheckoutSession,
    createOrgPortalSession,
    downloadMatterAiUsage,
    duplicateBuiltInWorkflow,
    getOrgPlan,
    getPersonalPlan,
    getPlans,
    getTabularReviewQuoteChecks,
    isConnectorSetupError,
    listWorkflowAttributions,
    recordLegalAcceptances,
    setMatterAiRestriction,
} from "./mikeApi";

const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("additional API endpoint contracts", () => {
    it.each([
        {
            name: "records the accepted legal document versions",
            call: () => recordLegalAcceptances([{ document: "terms", version: "2026-11-01" }]),
            url: "/api/user/legal-acceptances", method: "POST",
            body: { acceptances: [{ document: "terms", version: "2026-11-01" }] },
        },
        {
            name: "restricts matter AI with a reason",
            call: () => setMatterAiRestriction("matter/one?two", true, "Client instruction"),
            url: "/api/projects/matter%2Fone%3Ftwo/ai-restriction", method: "PUT",
            body: { restricted: true, reason: "Client instruction" },
        },
        {
            name: "removes a matter AI restriction without a reason",
            call: () => setMatterAiRestriction("matter/one?two", false),
            url: "/api/projects/matter%2Fone%3Ftwo/ai-restriction", method: "PUT",
            body: { restricted: false },
        },
        {
            name: "reads public plans", call: () => getPlans(),
            url: "/api/plans", method: "GET", body: undefined,
        },
        {
            name: "reads an organization plan", call: () => getOrgPlan("org-7"),
            url: "/api/orgs/org-7/plan", method: "GET", body: undefined,
        },
        {
            name: "reads the personal plan", call: () => getPersonalPlan(),
            url: "/api/plans/me", method: "GET", body: undefined,
        },
        {
            name: "starts checkout for the chosen plan", call: () => createOrgCheckoutSession("org-7", "team"),
            url: "/api/billing/orgs/org-7/checkout-session", method: "POST", body: { plan_key: "team" },
        },
        {
            name: "opens the billing portal", call: () => createOrgPortalSession("org-7"),
            url: "/api/billing/orgs/org-7/portal-session", method: "POST", body: undefined,
        },
        {
            name: "reads all quote checks", call: () => getTabularReviewQuoteChecks("review-7"),
            url: "/api/tabular-review/review-7/quote-checks", method: "GET", body: undefined,
        },
        {
            name: "duplicates a built-in workflow", call: () => duplicateBuiltInWorkflow("builtin-review"),
            url: "/api/workflows/builtin-review/duplicate", method: "POST", body: undefined,
        },
        {
            name: "lists catalog source attributions", call: () => listWorkflowAttributions(),
            url: "/api/workflows/attributions", method: "GET", body: undefined,
        },
    ])("$name", async ({ call, url, method, body }) => {
        const answer = { id: "result-7", url: "https://billing.example/session" };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer), {
            status: 200, headers: { "Content-Type": "application/json" },
        }));
        await expect(call()).resolves.toEqual(answer);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        expect(init.credentials).toBe("include");
        if (body === undefined) expect(init.body).toBeUndefined();
        else {
            expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
            expect(JSON.parse(String(init.body))).toEqual(body);
        }
    });

    it("narrows quote checks to the zero-indexed cell and forwards cancellation", async () => {
        const controller = new AbortController();
        const answer = { cells: [] };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer)));
        await expect(getTabularReviewQuoteChecks("review-7", {
            rowId: "row/one", columnIndex: 0, signal: controller.signal,
        })).resolves.toEqual(answer);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/tabular-review/review-7/quote-checks?row_id=row%2Fone&column_index=0");
        expect(init.signal).toBe(controller.signal);
    });

    it("downloads matter usage as CSV with the server filename", async () => {
        fetchMock.mockResolvedValueOnce(new Response("tokens,cost\n1,0.01", {
            headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"usage.csv\"" },
        }));
        const result = await downloadMatterAiUsage("matter/one?two");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/matter%2Fone%3Ftwo/usage?format=csv");
        expect(result.filename).toBe("usage.csv");
        expect(await result.blob.text()).toBe("tokens,cost\n1,0.01");
    });
});

describe("connector setup failure classification", () => {
    it("recognizes only the API error carrying the operator-setup code", () => {
        expect(isConnectorSetupError(new MikeApiError({
            message: "Operator setup is required.", status: 503, code: "connector_setup_required",
        }))).toBe(true);
        expect(isConnectorSetupError(new MikeApiError({
            message: "Another failure.", status: 503, code: "upstream_unavailable",
        }))).toBe(false);
        expect(isConnectorSetupError({ code: "connector_setup_required" })).toBe(false);
        expect(isConnectorSetupError(null)).toBe(false);
    });
});
