// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { BrandMark } from "@/shared/ui/BrandMarkUI";
import { pillButtonUIClassName } from "@/shared/ui/PillButtonUI.styles";
import { SITE_CHROME_COPY } from "@/content/site/chrome";
import { SiteNav } from "./SiteNav";

/**
 * The header of the public pages: the product mark and name (from the brand
 * configuration), the site navigation, and the way into the app. Every word
 * comes from content/site/chrome.ts. Wraps onto two rows on a narrow screen
 * rather than overflowing.
 */
export function SiteHeader() {
    return (
        <header className="border-b border-border">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
                <Link
                    href="/"
                    className="flex items-center gap-2 rounded-sm text-lg font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    style={{ fontFamily: "var(--brand-display-face)" }}
                >
                    <BrandMark size={22} />
                    <span data-slot="site-wordmark">{brand.productName}</span>
                </Link>
                <SiteNav />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Link
                        href="/login"
                        className={pillButtonUIClassName({ tone: "white", size: "normal" })}
                    >
                        {SITE_CHROME_COPY.signIn}
                    </Link>
                    <Link
                        href="/signup"
                        className={pillButtonUIClassName({ tone: "black", size: "normal" })}
                    >
                        {SITE_CHROME_COPY.createAccount}
                    </Link>
                </div>
            </div>
        </header>
    );
}
