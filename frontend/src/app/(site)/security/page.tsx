// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { ContentPage } from "@/app/components/content/ContentPage";
import { loadSecurityPage } from "@/app/components/content/siteContent";
import { siteRobotsMetadata } from "@/app/lib/siteFlags";
import { brand } from "@/shared/brand.generated";

export function generateMetadata(): Metadata {
    const page = loadSecurityPage();
    return {
        title: `${page.title} · ${brand.productName}`,
        description:
            "What the software does to protect accounts, keys and documents, stated as facts: encryption of stored keys, multi-factor authentication, single sign-on, the audit log, export and deletion, model providers, and independent certification.",
        // A draft stays out of search engines even on an indexable site, as
        // the legal documents do.
        robots: siteRobotsMetadata({ noindex: page.status === "draft" }),
    };
}

/**
 * The public security page: facts about what the software does, filled from
 * the brand configuration and the facts registries, with the draft banner
 * and version line of a legal document (brand.legalDocuments.security).
 */
export default function SecurityPage() {
    const page = loadSecurityPage();
    return (
        <ContentPage
            title={page.title}
            markdown={page.markdown}
            status={page.status}
            version={page.version}
        />
    );
}
