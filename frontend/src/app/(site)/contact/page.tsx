// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import {
    SITE_DISPLAY_STYLE,
    SITE_PAGE_TITLE_CLASS,
    SITE_PRIMARY_ACTION_SLOT,
    SITE_STANDALONE_LINK_CLASS,
    SITE_SUBHEADING_CLASS,
    SITE_TEXT_LINK_CLASS,
    sitePrimaryActionClassName,
} from "@/app/components/site/siteStyles";
import { siteEnabled, siteRobotsMetadata } from "@/app/lib/siteFlags";
import { CONTACT_COPY, contactMailto } from "@/content/site/contact";
import { brand } from "@/shared/brand.generated";

// Read when the page is rendered, like the security page's, so the flag is
// the build's and a test can vary it.
export function generateMetadata(): Metadata {
    return {
        title: `${CONTACT_COPY.title} · ${brand.productName}`,
        description: CONTACT_COPY.lede,
        // Out of search engines until the site is marked indexable.
        robots: siteRobotsMetadata(),
    };
}

/**
 * The public contact page: one action, an email to the brand's support
 * mailbox with its subject filled in. Around it only what helps that email
 * arrive useful (what to include, what to leave out) and the two pages that
 * may answer the question first. No form, no scheduler and no promise of
 * when a reply comes, unless the operator states one in the copy.
 */
export default function ContactPage() {
    const home = siteEnabled();
    return (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
            <h1 className={SITE_PAGE_TITLE_CLASS} style={SITE_DISPLAY_STYLE}>
                {CONTACT_COPY.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-fg-subtle">
                {CONTACT_COPY.lede}
            </p>
            {CONTACT_COPY.responseNote ? (
                <p
                    data-slot="contact-response-note"
                    className="mt-2 max-w-2xl text-base leading-7 text-fg-subtle"
                >
                    {CONTACT_COPY.responseNote}
                </p>
            ) : null}

            <div className="mt-8">
                <a
                    href={contactMailto()}
                    data-slot={SITE_PRIMARY_ACTION_SLOT}
                    className={sitePrimaryActionClassName()}
                >
                    {CONTACT_COPY.action}
                </a>
                <p className="mt-3 text-sm leading-6 text-fg-subtle">
                    {CONTACT_COPY.addressLead}{" "}
                    <span
                        data-slot="contact-address"
                        translate="no"
                        className="font-medium text-fg [overflow-wrap:anywhere]"
                    >
                        {brand.supportEmail}
                    </span>
                </p>
            </div>

            <section aria-labelledby="contact-include" className="mt-12">
                <h2
                    id="contact-include"
                    className={SITE_SUBHEADING_CLASS}
                    style={SITE_DISPLAY_STYLE}
                >
                    {CONTACT_COPY.includeHeading}
                </h2>
                <ul className="mt-4 max-w-prose list-disc space-y-1 pl-5 text-sm leading-6 text-fg-subtle marker:text-fg-muted">
                    {CONTACT_COPY.include.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
                <p className="mt-4 max-w-prose text-sm leading-6 text-fg">
                    {CONTACT_COPY.leaveOut}
                </p>
            </section>

            <section aria-labelledby="contact-pointers" className="mt-10">
                <h2
                    id="contact-pointers"
                    className={SITE_SUBHEADING_CLASS}
                    style={SITE_DISPLAY_STYLE}
                >
                    {CONTACT_COPY.pointersHeading}
                </h2>
                <ul className="mt-4 max-w-prose space-y-2 text-sm leading-6 text-fg-subtle">
                    {CONTACT_COPY.pointers.map((pointer) => (
                        <li key={pointer.href}>
                            <Link href={pointer.href} className={SITE_TEXT_LINK_CLASS}>
                                {pointer.label}
                            </Link>
                            {": "}
                            {pointer.note}
                        </li>
                    ))}
                </ul>
            </section>

            <p className="mt-10">
                <Link href="/" className={SITE_STANDALONE_LINK_CLASS}>
                    {home ? CONTACT_COPY.backToHome : CONTACT_COPY.backToApp}
                </Link>
            </p>
        </main>
    );
}
