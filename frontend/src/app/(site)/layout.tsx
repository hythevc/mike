// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteShell } from "@/app/components/site/SiteShell";
import { siteRobotsMetadata } from "@/app/lib/siteFlags";

// Rendered per request rather than prerendered: the app's providers read the
// search params on the server, which a static render cannot supply, so a
// static page would ship its loader as HTML and draw the content on the
// client. These pages are small; rendering them on request keeps their
// content in the HTML a visitor, or a crawler, receives.
export const dynamic = "force-dynamic";

// Out of search engines until the build sets NEXT_PUBLIC_SITE_INDEXABLE=true;
// a page overrides this only to stay out longer (a draft document).
export const metadata: Metadata = {
    robots: siteRobotsMetadata(),
};

/** The public pages: pricing, documentation and the security page. */
export default function SiteLayout({ children }: { children: ReactNode }) {
    return <SiteShell>{children}</SiteShell>;
}
