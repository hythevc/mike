// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public site, signed out: the home page (when the build has
 * NEXT_PUBLIC_SITE_ENABLED=true), /pricing, /docs and /security, each through
 * the shared accessibility gate in both themes; the security.txt and
 * robots.txt files; the security headers on a page route; and a signed-in
 * browser at / landing in the app.
 *
 * The home page flag is baked into the build (playwright.config.ts and the
 * e2e workflow set it). When a build runs without it, / redirects to the app
 * and the home test is skipped rather than failed: there is no home to scan.
 */
import { test, expect, type Page } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";

const HOME_HEADLINE = "Review, draft and negotiate with sources you can check.";

async function expectNoCheckout(page: Page) {
    const checkout = /checkout|subscribe|buy|purchase|upgrade/i;
    await expect(page.getByRole("link", { name: checkout })).toHaveCount(0);
    await expect(page.getByRole("button", { name: checkout })).toHaveCount(0);
}

test.describe("public site", () => {
    test.describe("signed out", () => {
        test.use({ storageState: { cookies: [], origins: [] } });

        test("/ shows the home page and passes the axe check", async ({ page }) => {
            await page.goto("/");
            await page.waitForLoadState("networkidle");
            const pathname = new URL(page.url()).pathname;
            test.skip(
                pathname !== "/",
                "NEXT_PUBLIC_SITE_ENABLED is not 'true' in this build: / redirects to the app",
            );
            await expect(
                page.getByRole("heading", { level: 1, name: HOME_HEADLINE }),
            ).toBeVisible();
            await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
            await expect(page.getByRole("contentinfo")).toBeVisible();
            await expectAccessibleInEveryTheme(page, "/");
        });

        test("/pricing shows the plans or that pricing is not available, with no checkout", async ({
            page,
        }) => {
            await page.goto("/pricing");
            await expect(
                page.getByRole("heading", { level: 1, name: "Pricing" }),
            ).toBeVisible();
            // The plans load from GET /plans; wait for the loading state to end.
            await expect(page.getByRole("status")).toHaveCount(0);
            const unavailable = page.getByText("Pricing is not available yet.");
            const plans = page.getByRole("heading", { level: 2 });
            await expect(unavailable.or(plans.first())).toBeVisible();
            await expectNoCheckout(page);
            await expect(page.getByRole("link", { name: "Create an account" }).first()).toBeVisible();
            await expectAccessibleInEveryTheme(page, "/pricing");
        });

        test("/docs lists the documentation pages and passes the axe check", async ({ page }) => {
            await page.goto("/docs");
            await expect(
                page.getByRole("heading", { level: 1, name: "Documentation" }),
            ).toBeVisible();
            for (const title of [
                "Getting started",
                "Tabular review and quote status",
                "Data and privacy",
                "Source code and licences",
            ]) {
                await expect(page.getByRole("link", { name: title })).toBeVisible();
            }
            await expectAccessibleInEveryTheme(page, "/docs");
        });

        test("/docs/getting-started renders a documentation page", async ({ page }) => {
            await page.goto("/docs/getting-started");
            await expect(
                page.getByRole("heading", { level: 1, name: "Getting started" }),
            ).toBeVisible();
            await expect(page.getByText(/legal information, not legal advice/i).first()).toBeVisible();
            await expectAccessibleInEveryTheme(page, "/docs/getting-started");
        });

        test("/security states the facts and passes the axe check", async ({ page }) => {
            await page.goto("/security");
            await expect(
                page.getByRole("heading", { level: 1, name: "Security" }),
            ).toBeVisible();
            await expect(
                page.getByRole("heading", { name: "Independent certification" }),
            ).toBeVisible();
            await expect(page.getByText(/legal information, not legal advice/i).first()).toBeVisible();
            await expectAccessibleInEveryTheme(page, "/security");
        });

        test("security.txt names a contact and a future Expires", async ({ page }) => {
            const response = await page.request.get("/.well-known/security.txt");
            expect(response.status()).toBe(200);
            expect(response.headers()["content-type"]).toContain("text/plain");
            const body = await response.text();
            expect(body).toMatch(/^Contact: mailto:[^\s@]+@[^\s@]+$/m);
            const expires = /^Expires: (.+)$/m.exec(body);
            expect(expires).not.toBeNull();
            expect(new Date(expires![1]).getTime()).toBeGreaterThan(Date.now());
        });

        test("robots.txt is served", async ({ page }) => {
            const response = await page.request.get("/robots.txt");
            expect(response.status()).toBe(200);
            const body = await response.text();
            expect(body).toMatch(/user-agent: \*/i);
            // Not indexable unless the build says so; CI builds do not.
            if (process.env.NEXT_PUBLIC_SITE_INDEXABLE !== "true") {
                expect(body).toMatch(/^disallow: \/$/im);
            }
        });

        test("page routes carry the security headers", async ({ page }) => {
            const response = await page.request.get("/pricing");
            const headers = response.headers();
            expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
            expect(headers["x-content-type-options"]).toBe("nosniff");
            expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
            expect(headers["permissions-policy"]).toContain("camera=()");
            expect(headers["permissions-policy"]).toContain("microphone=()");
            expect(headers["permissions-policy"]).toContain("geolocation=()");
            expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");
        });
    });

    test("a signed-in browser at / lands in the app", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL(/\/assistant/);
    });
});
