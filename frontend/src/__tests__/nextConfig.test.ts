// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Reads next.config.ts as Next does and checks what it serves: the security
// headers on page routes, and no leftover rewrite to the sitemap routes that
// no longer exist.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    NOINDEX_HEADER_VALUE,
    PAGE_HEADERS_SOURCE,
    REPORT_ONLY_CSP,
} from "@/app/lib/securityHeaders";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type ConfigShape = {
    headers?: () => Promise<HeaderRule[]>;
    rewrites?: () => Promise<unknown>;
    redirects?: () => Promise<{ source: string }[]>;
};

async function loadConfig(): Promise<ConfigShape> {
    vi.resetModules();
    const loaded = (await import("../../next.config")) as { default: ConfigShape };
    return loaded.default;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("next.config.ts", () => {
    it("sets the security headers on page routes", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        const config = await loadConfig();
        expect(config.headers).toBeTypeOf("function");
        const rules = await config.headers!();
        const pages = rules.find((rule) => rule.source === PAGE_HEADERS_SOURCE);
        expect(pages, "a rule for page routes").toBeDefined();
        const byKey = Object.fromEntries(
            pages!.headers.map((header) => [header.key, header.value]),
        );
        expect(byKey["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
        expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
        expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
        expect(byKey["Permissions-Policy"]).toBe(
            "camera=(), microphone=(), geolocation=()",
        );
        expect(byKey["Content-Security-Policy-Report-Only"]).toBe(REPORT_ONLY_CSP);
        // Not indexable by default: every page also says noindex.
        expect(byKey["X-Robots-Tag"]).toBe(NOINDEX_HEADER_VALUE);
    });

    it("drops X-Robots-Tag when the site is indexable", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        const config = await loadConfig();
        const rules = await config.headers!();
        const keys = rules.flatMap((rule) => rule.headers.map((h) => h.key));
        expect(keys).not.toContain("X-Robots-Tag");
    });

    it("no longer rewrites /sitemap.xml to routes that do not exist", async () => {
        const config = await loadConfig();
        const rewrites = config.rewrites ? await config.rewrites() : [];
        expect(JSON.stringify(rewrites)).not.toContain("sitemap");
    });

    it("keeps the /account redirects", async () => {
        const config = await loadConfig();
        const redirects = await config.redirects!();
        expect(redirects.map((r) => r.source)).toEqual(["/account", "/account/:path*"]);
    });
});
