// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    FRAME_ANCESTORS_POLICY,
    NOINDEX_HEADER_VALUE,
    PAGE_HEADERS_SOURCE,
    REPORT_ONLY_CSP,
    pageHeaders,
    securityHeaderRules,
} from "./securityHeaders";

afterEach(() => {
    vi.unstubAllEnvs();
});

function header(entries: { key: string; value: string }[], key: string) {
    const found = entries.filter((entry) => entry.key === key);
    expect(found, `exactly one ${key} header`).toHaveLength(1);
    return found[0].value;
}

/** Next's `source` is a path-to-regexp pattern; mirror the one branch it uses. */
function sourceMatches(source: string, path: string): boolean {
    const pattern = source.replace(/^\/\((.*)\)$/, (_m, inner: string) => `^/(${inner})$`);
    return new RegExp(pattern).test(path);
}

describe("pageHeaders", () => {
    it("enforces frame-ancestors 'self', nosniff, the referrer and permissions policies", () => {
        const headers = pageHeaders({ indexable: true });
        expect(header(headers, "Content-Security-Policy")).toBe(FRAME_ANCESTORS_POLICY);
        expect(header(headers, "X-Content-Type-Options")).toBe("nosniff");
        expect(header(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        const permissions = header(headers, "Permissions-Policy");
        expect(permissions).toContain("camera=()");
        expect(permissions).toContain("microphone=()");
        expect(permissions).toContain("geolocation=()");
    });

    it("sends the full policy in report-only mode, never enforced", () => {
        const headers = pageHeaders({ indexable: true });
        const reportOnly = header(headers, "Content-Security-Policy-Report-Only");
        expect(reportOnly).toBe(REPORT_ONLY_CSP);
        expect(reportOnly).toContain("default-src 'self'");
        expect(reportOnly).toContain("object-src 'none'");
        expect(reportOnly).toContain("frame-ancestors 'self'");
        // The enforced header carries only the framing directive.
        expect(header(headers, "Content-Security-Policy")).not.toContain("default-src");
    });

    it("adds noindex while the site is not indexable, and drops it once it is", () => {
        expect(header(pageHeaders({ indexable: false }), "X-Robots-Tag")).toBe(
            NOINDEX_HEADER_VALUE,
        );
        expect(
            pageHeaders({ indexable: true }).some((h) => h.key === "X-Robots-Tag"),
        ).toBe(false);
    });

    it("reads the indexable default from NEXT_PUBLIC_SITE_INDEXABLE", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        expect(pageHeaders().some((h) => h.key === "X-Robots-Tag")).toBe(true);
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        expect(pageHeaders().some((h) => h.key === "X-Robots-Tag")).toBe(false);
    });
});

describe("securityHeaderRules", () => {
    it("applies to page routes but not to the API gateway or the Sentry tunnel", () => {
        const rules = securityHeaderRules({ indexable: false });
        expect(rules).toHaveLength(1);
        expect(rules[0].source).toBe(PAGE_HEADERS_SOURCE);
        for (const path of ["/", "/pricing", "/docs/getting-started", "/security", "/assistant", "/login"]) {
            expect(sourceMatches(PAGE_HEADERS_SOURCE, path), path).toBe(true);
        }
        for (const path of ["/api/plans", "/api/auth/session", "/monitoring"]) {
            expect(sourceMatches(PAGE_HEADERS_SOURCE, path), path).toBe(false);
        }
        expect(rules[0].headers).toEqual(pageHeaders({ indexable: false }));
    });
});
