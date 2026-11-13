// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/lib/utils";
import { CONTACT_PATH, SITE_CHROME_COPY } from "@/content/site/chrome";
import {
    SITE_FOCUS_CLASS,
    SITE_PRIMARY_ACTION_SLOT,
    sitePrimaryActionClassName,
    siteSecondaryActionClassName,
} from "./siteStyles";

// Every header link is 44px tall, so the row is as easy to use with a thumb
// as with a pointer; hover changes the colour at once, with no transition.
const linkClassName = cn(
    "inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-fg-subtle underline-offset-8 hover:text-fg",
    SITE_FOCUS_CLASS,
);

/**
 * The site's primary navigation: real links in a nav landmark, the current
 * page marked with aria-current and an underline (never by colour alone),
 * the same way the app's sidebar does it. The pages and their labels come
 * from content/site/chrome.ts. The landmark keeps its natural width, so on a
 * narrow screen it moves to a row of its own as a whole when it no longer
 * fits beside the name; the list inside wraps only as a last resort.
 */
export function SiteNav() {
    const pathname = usePathname() ?? "";
    return (
        <nav aria-label={SITE_CHROME_COPY.navLabel}>
            <ul className="flex flex-wrap items-center gap-x-4 sm:gap-x-5">
                {SITE_CHROME_COPY.nav.map((item) => {
                    const current =
                        pathname === item.href ||
                        pathname.startsWith(`${item.href}/`);
                    return (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                aria-current={current ? "page" : undefined}
                                className={cn(linkClassName, current && "text-fg underline")}
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

/**
 * The pages that carry their one filled action in the page itself: the home
 * page and the pricing page (create an account) and the contact page (send
 * an email). `SiteShell.test.tsx` renders each of them to keep this list and
 * the pages in step.
 */
export const PAGES_WITH_OWN_ACTION: readonly string[] = ["/", "/pricing", CONTACT_PATH];

/**
 * The way into the app, at the end of the header: sign in as a link, and the
 * account link as a button. A public page has one filled button. Where the
 * page carries its own (`PAGES_WITH_OWN_ACTION`) the account link here is
 * outlined instead, at the same size, so nothing moves from page to page and
 * the page's own action is the one that stands out.
 *
 * Below the `sm` breakpoint the two links take a row of their own under the
 * name and the navigation; from there up they sit at the far end of the row.
 */
export function SiteAccountLinks() {
    const pathname = usePathname() ?? "";
    const pageHasOwnAction = PAGES_WITH_OWN_ACTION.includes(pathname);
    return (
        <div className="flex w-full flex-wrap items-center gap-x-4 sm:ml-auto sm:w-auto">
            <Link href="/login" className={linkClassName}>
                {SITE_CHROME_COPY.signIn}
            </Link>
            <Link
                href="/signup"
                data-slot={pageHasOwnAction ? undefined : SITE_PRIMARY_ACTION_SLOT}
                className={
                    pageHasOwnAction
                        ? siteSecondaryActionClassName()
                        : sitePrimaryActionClassName()
                }
            >
                {SITE_CHROME_COPY.createAccount}
            </Link>
        </div>
    );
}
