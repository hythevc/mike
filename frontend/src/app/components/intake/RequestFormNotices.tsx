// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId } from "react";
import type { RequestDeskPublicForm } from "@/app/lib/mikeApi";
import {
    HUMAN_REPLY_NOTICE,
    NOTICES_AFTER_HEADING,
    NOTICES_BEFORE_HEADING,
    PRIVACY_POLICY_LINK_LABEL,
    organizationNoticeLead,
    retentionNotice,
} from "./requestFormLabels";

const linkClassName =
    "rounded-sm font-medium text-fg underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2";

/**
 * The notices every requester reads: the organization's own notice, named as
 * theirs, the product's line that no AI advice is shown and a person replies,
 * the organization's privacy notice, and how long a submission is kept.
 * Plain text, so it reads the same for everyone.
 *
 * It is shown once, in one place: above the Send button before a request is
 * sent ("Before you send"), and under the reference once it is in ("What
 * happens next"), where the organization's notice is what says what happens
 * next, in its own words. Each sentence therefore appears exactly once on the
 * page in either state, and nothing here adds a promise of its own about when
 * or how a reply comes.
 */
export function RequestFormNotices({
    form,
    submitted = false,
}: {
    form: RequestDeskPublicForm;
    submitted?: boolean;
}) {
    const headingId = useId();
    // Under the receipt's own heading once sent; a section of the form before.
    const Heading = submitted ? "h3" : "h2";
    return (
        <section
            aria-labelledby={headingId}
            data-slot="request-form-notices"
            className="space-y-3 text-sm leading-6 text-fg-subtle [overflow-wrap:anywhere]"
        >
            <Heading id={headingId} className="text-sm font-medium text-fg">
                {submitted ? NOTICES_AFTER_HEADING : NOTICES_BEFORE_HEADING}
            </Heading>
            <div>
                <p className="text-fg-muted">
                    {organizationNoticeLead(form.organization.name)}
                </p>
                <p className="whitespace-pre-wrap">{form.disclaimer}</p>
            </div>
            <p>{HUMAN_REPLY_NOTICE}</p>
            <p className="whitespace-pre-wrap">
                {form.privacy_notice}
                {form.privacy_policy_url ? (
                    <>
                        {" "}
                        <a
                            href={form.privacy_policy_url}
                            target="_blank"
                            rel="noreferrer"
                            className={linkClassName}
                        >
                            {PRIVACY_POLICY_LINK_LABEL}
                        </a>
                        .
                    </>
                ) : null}
            </p>
            <p>{retentionNotice(form.retention_days)}</p>
        </section>
    );
}
