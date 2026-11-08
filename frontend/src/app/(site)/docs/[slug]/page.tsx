// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentPage } from "@/app/components/content/ContentPage";
import { loadDocsPage } from "@/app/components/content/siteContent";
import { DOCS_INDEX_COPY } from "@/content/docs/registry";
import { brand } from "@/shared/brand.generated";

interface PageProps {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const loaded = loadDocsPage(slug);
    if (!loaded) return {};
    return {
        title: `${loaded.page.title} · ${brand.productName}`,
        description: loaded.page.summary,
    };
}

/** One documentation page, rendered through the shared ContentPage. */
export default async function DocsPage({ params }: PageProps) {
    const { slug } = await params;
    const loaded = loadDocsPage(slug);
    if (!loaded) notFound();
    return (
        <>
            <nav
                aria-label="Breadcrumb"
                className="mx-auto w-full max-w-3xl px-4 pt-8 text-sm text-fg-muted sm:px-6"
            >
                <Link
                    href="/docs"
                    className="rounded-sm underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                    {DOCS_INDEX_COPY.title}
                </Link>
            </nav>
            <ContentPage title={loaded.page.title} markdown={loaded.markdown} />
        </>
    );
}
