// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The frame of every public page: header, the page's own `main`, footer. The
 * (site) route group's layout renders it, and so does the home page at `/`,
 * which lives outside the group because the app's root page is its home.
 */
export function SiteShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-dvh flex-col bg-app-background text-fg">
            <SiteHeader />
            <div className="flex flex-1 flex-col">{children}</div>
            <SiteFooter />
        </div>
    );
}
