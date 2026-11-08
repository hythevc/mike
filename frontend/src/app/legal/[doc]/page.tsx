// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/app/components/content/ContentPage";
import { loadLegalDocument } from "@/app/components/content/legalContent";
import { LEGAL_DOCUMENT_SLUGS } from "@/content/legal/registry";

interface PageProps {
    params: Promise<{ doc: string }>;
}

/** Pre-render every known legal page at build time. */
export function generateStaticParams(): { doc: string }[] {
    return LEGAL_DOCUMENT_SLUGS.map((doc) => ({ doc }));
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { doc } = await params;
    const loaded = loadLegalDocument(doc);
    if (!loaded) return {};
    // A draft is written but not in effect: keep it out of search engines
    // until counsel clears it and its status becomes in-effect.
    const noindex = loaded.doc.status === "draft";
    return {
        title: loaded.doc.title,
        robots: noindex
            ? { index: false, follow: false }
            : undefined,
    };
}

export default async function LegalDocumentPage({ params }: PageProps) {
    const { doc } = await params;
    const loaded = loadLegalDocument(doc);
    if (!loaded) notFound();
    return (
        <ContentPage
            title={loaded.doc.title}
            markdown={loaded.markdown}
            status={loaded.doc.status}
            version={loaded.doc.version}
        />
    );
}
