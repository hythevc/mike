// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { listDocsPages } from "@/app/components/content/siteContent";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { DOCS_INDEX_COPY } from "@/content/docs/registry";
import { brand } from "@/shared/brand.generated";

export const metadata: Metadata = {
    title: `${DOCS_INDEX_COPY.title} · ${brand.productName}`,
    description: DOCS_INDEX_COPY.intro,
};

const linkClassName =
    "rounded-sm text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The documentation index: one card per page in the docs registry. */
export default function DocsIndexPage() {
    const pages = listDocsPages();
    return (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
            <h1
                className="text-3xl font-medium tracking-tight text-fg sm:text-4xl"
                style={{ fontFamily: "var(--brand-display-face)" }}
            >
                {DOCS_INDEX_COPY.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-fg-subtle">
                {DOCS_INDEX_COPY.intro}
            </p>
            <ul className="mt-8 space-y-4">
                {pages.map((page) => (
                    <li key={page.slug}>
                        <GlassCardUI>
                            <div className="p-5">
                                <h2 className="text-lg font-semibold">
                                    <Link href={`/docs/${page.slug}`} className={linkClassName}>
                                        {page.title}
                                    </Link>
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-fg-subtle">
                                    {page.summary}
                                </p>
                            </div>
                        </GlassCardUI>
                    </li>
                ))}
            </ul>
            <p className="mt-10 text-sm text-fg-muted">{DOCS_INDEX_COPY.disclaimer}</p>
        </main>
    );
}
