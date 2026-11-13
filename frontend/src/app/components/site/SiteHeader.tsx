// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { BrandMark } from "@/shared/ui/BrandMarkUI";
import { cn } from "@/app/lib/utils";
import { SiteAccountLinks, SiteNav } from "./SiteNav";
import { SITE_DISPLAY_STYLE, SITE_FOCUS_CLASS } from "./siteStyles";

/**
 * The header of the public pages: the product mark and name (from the brand
 * configuration), the site navigation, and the way into the app. Every word
 * comes from content/site/chrome.ts.
 *
 * There is no menu button: three pages and two account links fit without
 * one. The row wraps instead. On a phone the name and the navigation share
 * the first row while they fit (the navigation moves down as a whole when
 * they do not) and the account links take the next; from the `sm` breakpoint
 * up everything is on one line. Every link is 44px tall at every width, and
 * a long product name wraps instead of pushing the page sideways.
 */
export function SiteHeader() {
    return (
        <header className="border-b border-border">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 px-4 py-2 sm:gap-x-6 sm:px-6 sm:py-3">
                <Link
                    href="/"
                    className={cn(
                        "flex min-h-11 min-w-0 items-center gap-2 rounded-sm text-lg font-medium text-fg",
                        SITE_FOCUS_CLASS,
                    )}
                    style={SITE_DISPLAY_STYLE}
                >
                    <BrandMark size={22} />
                    <span data-slot="site-wordmark" className="[overflow-wrap:anywhere]">
                        {brand.productName}
                    </span>
                </Link>
                <SiteNav />
                <SiteAccountLinks />
            </div>
        </header>
    );
}
