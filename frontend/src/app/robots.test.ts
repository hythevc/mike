// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ROUTE_ROOTS } from "@/app/lib/authRedirects";
import robots, { CRAWL_EXCLUDED_PATHS } from "./robots";

afterEach(() => {
    vi.unstubAllEnvs();
});

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };

function rules(): Rule[] {
    const result = robots().rules;
    return Array.isArray(result) ? result : [result];
}

describe("robots.txt", () => {
    it("keeps every crawler out unless NEXT_PUBLIC_SITE_INDEXABLE is 'true'", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        expect(rules()).toEqual([{ userAgent: "*", disallow: "/" }]);
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "false");
        expect(rules()).toEqual([{ userAgent: "*", disallow: "/" }]);
    });

    it("lets crawlers index the public pages, but not the app, once indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        const [rule] = rules();
        expect(rule.userAgent).toBe("*");
        expect(rule.allow).toBe("/");
        expect(rule.disallow).toEqual([...CRAWL_EXCLUDED_PATHS]);
        for (const path of ["/api/", "/assistant", "/settings", "/login", "/monitoring"]) {
            expect(rule.disallow).toContain(path);
        }
        for (const path of ["/pricing", "/docs", "/security", "/legal/", "/source"]) {
            expect(rule.disallow).not.toContain(path);
        }
    });

    it("excludes every top-level page of the signed-in app, taken from the sign-in redirect list", () => {
        // A new directory under (pages)/ is added to APP_ROUTE_ROOTS
        // (authRedirects.ts) once: that keeps it out of search results here
        // and lets a deep link to it survive sign-in.
        const roots = readdirSync(join(__dirname, "(pages)"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => !name.startsWith("(") && !name.startsWith("_"));
        expect(roots.length).toBeGreaterThan(0);
        for (const root of roots) {
            expect(APP_ROUTE_ROOTS).toContain(`/${root}`);
            expect(CRAWL_EXCLUDED_PATHS).toContain(`/${root}`);
        }
    });

    it("excludes the pages around sign-in, the support page and the request forms", () => {
        for (const path of [
            "/onboarding",
            "/login",
            "/signup",
            "/forgot-password",
            "/reset-password",
            "/verify-mfa",
            "/auth/",
            "/support",
            "/request/",
        ]) {
            expect(CRAWL_EXCLUDED_PATHS).toContain(path);
        }
    });
});
