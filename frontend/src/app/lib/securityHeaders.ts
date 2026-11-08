// SPDX-License-Identifier: AGPL-3.0-only
//
// The response headers the web app sets on its own pages (next.config.ts
// `headers()`). Kept here, as data, so a unit test can read the same policy
// the server sends, and so next.config.ts stays a thin wrapper.
//
// What is enforced:
//
// - `Content-Security-Policy: frame-ancestors 'self'` — no other site may put
//   the app in a frame. The Word add-in never frames the web app: its sign-in
//   opens in a separate dialog window, and its task pane is its own origin.
//   `frame-ancestors` is the one CSP directive browsers ignore in report-only
//   mode, which is why it is sent as an enforced policy of its own.
// - `X-Content-Type-Options: nosniff`, `Referrer-Policy:
//   strict-origin-when-cross-origin`, and a `Permissions-Policy` that turns
//   camera, microphone and geolocation off: the app uses none of them.
//
// What is only reported: a full Content-Security-Policy in report-only mode.
// Browsers log what it would have blocked and send nothing to the server (no
// reporting endpoint is configured); it records what an enforced policy will
// have to allow before one is switched on. `'unsafe-inline'` and
// `'unsafe-eval'` in script-src cover Next's inline bootstrap and the
// development overlay; the Google script is the Drive picker.
//
// The headers go on every route but the API gateway (`/api/*`, whose
// responses carry the API's own headers through unchanged) and the Sentry
// tunnel (`/monitoring`).

import { siteIndexable } from "./siteFlags";

/** Every path but the API gateway and the error-reporting tunnel. */
export const PAGE_HEADERS_SOURCE = "/((?!api/|monitoring).*)";

export interface HeaderEntry {
    key: string;
    value: string;
}

export interface HeaderRule {
    source: string;
    headers: HeaderEntry[];
}

/** The enforced framing policy: only this origin may frame the app. */
export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'self'";

/** The report-only policy, one directive per entry. */
export const REPORT_ONLY_CSP_DIRECTIVES: readonly string[] = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://docs.google.com https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    FRAME_ANCESTORS_POLICY,
];

export const REPORT_ONLY_CSP = REPORT_ONLY_CSP_DIRECTIVES.join("; ");

/** The value of X-Robots-Tag while the site is not indexable. */
export const NOINDEX_HEADER_VALUE = "noindex, nofollow";

/**
 * The headers for the page routes. `indexable` defaults to the build's
 * NEXT_PUBLIC_SITE_INDEXABLE flag; while it is off every response also says
 * `X-Robots-Tag: noindex, nofollow`, so a preview or a self-hosted install is
 * kept out of search engines whatever a page's own metadata says.
 */
export function pageHeaders(
    options: { indexable?: boolean } = {},
): HeaderEntry[] {
    const indexable = options.indexable ?? siteIndexable();
    const headers: HeaderEntry[] = [
        { key: "Content-Security-Policy", value: FRAME_ANCESTORS_POLICY },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
        },
        { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
    ];
    if (!indexable) {
        headers.push({ key: "X-Robots-Tag", value: NOINDEX_HEADER_VALUE });
    }
    return headers;
}

/** The complete `headers()` result for next.config.ts. */
export function securityHeaderRules(
    options: { indexable?: boolean } = {},
): HeaderRule[] {
    return [{ source: PAGE_HEADERS_SOURCE, headers: pageHeaders(options) }];
}
