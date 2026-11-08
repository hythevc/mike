// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
