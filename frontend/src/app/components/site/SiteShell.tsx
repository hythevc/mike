// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { SITE_CHROME_COPY } from "@/content/site/chrome";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** Where "Skip to content" lands: the element that holds the page's `main`. */
export const SITE_CONTENT_ID = "site-content";

/**
 * The frame of every public page: header, the page's own `main`, footer. The
 * (site) route group's layout renders it, and so does the home page at `/`,
 * which lives outside the group because the app's root page is its home.
 *
 * The first thing in it is a link past the header, which appears when it
 * takes keyboard focus, so a keyboard or screen-reader user does not walk
 * the header's links again on every page.
 */
export function SiteShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-dvh flex-col bg-app-background text-fg">
            <a
                href={`#${SITE_CONTENT_ID}`}
                className="sr-only rounded-md bg-surface-elevated px-4 py-2 text-sm font-medium text-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
                {SITE_CHROME_COPY.skipToContent}
            </a>
            <SiteHeader />
            <div
                id={SITE_CONTENT_ID}
                tabIndex={-1}
                className="flex flex-1 flex-col focus-visible:outline-none"
            >
                {children}
            </div>
            <SiteFooter />
        </div>
    );
}
