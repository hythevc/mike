// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/lib/utils";
import { SITE_CHROME_COPY } from "@/content/site/chrome";

const linkClassName =
    "rounded-sm text-sm font-medium text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The site's primary navigation: real links in a nav landmark, the current
 * page marked with aria-current, the same way the app's sidebar does it. The
 * pages and their labels come from content/site/chrome.ts.
 */
export function SiteNav() {
    const pathname = usePathname() ?? "";
    return (
        <nav aria-label={SITE_CHROME_COPY.navLabel}>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {SITE_CHROME_COPY.nav.map((item) => {
                    const current =
                        pathname === item.href ||
                        pathname.startsWith(`${item.href}/`);
                    return (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                aria-current={current ? "page" : undefined}
                                className={cn(linkClassName, current && "text-fg")}
                            >
                                {item.label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
