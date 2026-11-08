// SPDX-License-Identifier: AGPL-3.0-only
//
// /robots.txt. The public site is not indexable unless the build sets
// NEXT_PUBLIC_SITE_INDEXABLE=true: a preview or a self-hosted install is not
// the product's website. Until then every crawler is asked to stay out, and
// every page also carries `noindex` (the X-Robots-Tag header in
// next.config.ts and the pages' own metadata). Once indexable, the signed-in
// app, the gateway and the sign-in pages stay out; the public pages do not.

import type { MetadataRoute } from "next";
import { siteIndexable } from "@/app/lib/siteFlags";

/** Paths crawlers are kept out of even on an indexable site. */
export const CRAWL_EXCLUDED_PATHS: readonly string[] = [
    "/api/",
    "/monitoring",
    "/assistant",
    "/history",
    "/ide",
    "/intake",
    "/library",
    "/organizations",
    "/playbooks",
    "/projects",
    "/settings",
    "/tabular-reviews",
    "/workflows",
    "/onboarding",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-mfa",
    "/auth/",
    "/support",
    "/request/",
];

export default function robots(): MetadataRoute.Robots {
    if (!siteIndexable()) {
        return { rules: [{ userAgent: "*", disallow: "/" }] };
    }
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: [...CRAWL_EXCLUDED_PATHS] }],
    };
}
