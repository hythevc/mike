// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/lib/utils";

/** The public pages the site header links to, in order. */
export const SITE_NAV_ITEMS: readonly { href: string; label: string }[] = [
    { href: "/pricing", label: "Pricing" },
    { href: "/docs", label: "Docs" },
    { href: "/security", label: "Security" },
];

const linkClassName =
    "rounded-sm text-sm font-medium text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The site's primary navigation: real links in a nav landmark, the current
 * page marked with aria-current, the same way the app's sidebar does it.
 */
export function SiteNav() {
    const pathname = usePathname() ?? "";
    return (
        <nav aria-label="Site">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {SITE_NAV_ITEMS.map((item) => {
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
