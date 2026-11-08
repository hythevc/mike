// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { getBuildInfo, repositoryFileUrl } from "@/app/lib/buildInfo";
import { SITE_CHROME_COPY } from "@/content/site/chrome";

const linkClassName =
    "rounded-sm underline-offset-2 transition-colors hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The footer of the public pages. Like the signed-out AuthFooter it carries
 * the source offer (the repository at the running commit, AGPL-3.0 section
 * 13), the terms and the privacy notice, and adds the security page and the
 * open-source attributions, then the line that these pages describe a tool,
 * not advice. Every address comes from the brand configuration or the
 * running build; every word from content/site/chrome.ts.
 */
export function SiteFooter() {
    const build = getBuildInfo();
    const { footer } = SITE_CHROME_COPY;
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
                <nav aria-label={SITE_CHROME_COPY.footerNavLabel}>
                    <ul className="flex flex-wrap gap-x-5 gap-y-1">
                        <li>
                            <a
                                href={build.sourceTreeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={linkClassName}
                            >
                                {footer.source}
                            </a>
                        </li>
                        <li>
                            <Link href={brand.legalDocuments.terms.url} className={linkClassName}>
                                {footer.terms}
                            </Link>
                        </li>
                        <li>
                            <Link href={brand.legalDocuments.privacy.url} className={linkClassName}>
                                {footer.privacy}
                            </Link>
                        </li>
                        <li>
                            <Link href={brand.legalDocuments.security.url} className={linkClassName}>
                                {footer.security}
                            </Link>
                        </li>
                        <li>
                            <a
                                href={repositoryFileUrl(build, "CREDITS.md")}
                                target="_blank"
                                rel="noreferrer"
                                className={linkClassName}
                            >
                                {footer.attributions}
                            </a>
                        </li>
                    </ul>
                </nav>
                <p>{SITE_CHROME_COPY.disclaimer}</p>
            </div>
        </footer>
    );
}
