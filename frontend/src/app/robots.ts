// SPDX-License-Identifier: AGPL-3.0-only
//
// /robots.txt. The public site is not indexable unless the build sets
// NEXT_PUBLIC_SITE_INDEXABLE=true: a preview or a self-hosted install is not
// the product's website. Until then every crawler is asked to stay out, and
// every page also carries `noindex` (the X-Robots-Tag header in
// next.config.ts and the pages' own metadata). Once indexable, the signed-in
// app, the gateway and the sign-in pages stay out; the public pages do not.

import type { MetadataRoute } from "next";
import { APP_ROUTE_ROOTS } from "@/app/lib/authRedirects";
import { siteIndexable } from "@/app/lib/siteFlags";

/**
 * The pages around sign-in (entering, recovering and confirming an account,
 * onboarding, the OAuth callbacks), the support page and the request-desk
 * forms: none of them is a page for a search engine to list.
 */
const SIGN_IN_AND_FORM_PATHS = [
    "/onboarding",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-mfa",
    "/auth/",
    "/support",
    "/request/",
] as const;

/**
 * Paths crawlers are kept out of even on an indexable site: the API gateway
 * and the error-reporting tunnel, every top-level route of the signed-in app
 * (the same list the sign-in redirects trust, so a new app page is excluded
 * here the day it is added there), and the pages around sign-in.
 */
export const CRAWL_EXCLUDED_PATHS: readonly string[] = [
    "/api/",
    "/monitoring",
    ...APP_ROUTE_ROOTS,
    ...SIGN_IN_AND_FORM_PATHS,
];

export default function robots(): MetadataRoute.Robots {
    if (!siteIndexable()) {
        return { rules: [{ userAgent: "*", disallow: "/" }] };
    }
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: [...CRAWL_EXCLUDED_PATHS] }],
    };
}
