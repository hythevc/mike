// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from "react";
import Link from "next/link";
import { PRICING_COPY } from "@/content/site/pricing";
import {
    securityFactLine,
    trustStripFacts,
    type SecurityFact,
} from "@/content/site/securityFacts";
import { brand } from "@/shared/brand.generated";
import { SITE_TEXT_LINK_CLASS } from "./siteStyles";

/**
 * A few security facts, shown directly under a page's action so the evidence
 * sits beside the thing it is evidence for. Every line is a fact from
 * content/site/securityFacts.ts, printed with the same function the security
 * page uses, so the two pages cannot say different things; the link leads
 * there. A fact that is not in place yet starts with the date it is due.
 *
 * Plain text on purpose: no tick, shield or badge, because none of these
 * lines is a certification and the last one says that none exists.
 */
export function TrustStrip({
    facts = trustStripFacts(),
}: {
    facts?: readonly SecurityFact[];
}) {
    const labelId = useId();
    return (
        <div data-slot="trust-strip" className="max-w-2xl text-sm leading-6">
            <p id={labelId} className="font-medium text-fg">
                {PRICING_COPY.trustHeading}
            </p>
            <ul
                aria-labelledby={labelId}
                className="mt-1 list-disc space-y-1 pl-5 text-fg-subtle marker:text-fg-muted"
            >
                {facts.map((fact) => (
                    <li key={fact.id} data-fact={fact.id}>
                        {securityFactLine(fact)}
                    </li>
                ))}
            </ul>
            <p className="mt-2">
                <Link href={brand.legalDocuments.security.url} className={SITE_TEXT_LINK_CLASS}>
                    {PRICING_COPY.trustLink}
                </Link>
            </p>
        </div>
    );
}
