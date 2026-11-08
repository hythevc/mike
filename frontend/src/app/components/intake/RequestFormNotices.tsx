// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { RequestDeskPublicForm } from "@/app/lib/mikeApi";
import { HUMAN_REPLY_NOTICE, retentionNotice } from "./requestFormLabels";

const linkClassName =
    "rounded-sm font-medium text-fg underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2";

/**
 * The notices every requester sees before and after submitting: the
 * organization's disclaimer and privacy notice in its own words, the
 * product's line that no AI advice is shown and a person replies, and how
 * long a submission is kept. Plain text, so it reads the same for everyone.
 */
export function RequestFormNotices({ form }: { form: RequestDeskPublicForm }) {
    return (
        <section aria-labelledby="request-form-notices" className="space-y-3 text-sm text-fg-subtle">
            <h2 id="request-form-notices" className="text-sm font-semibold text-fg">
                Before you submit
            </h2>
            <p>{form.disclaimer}</p>
            <p>{HUMAN_REPLY_NOTICE}</p>
            <p>
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
                            Read the privacy policy
                        </a>
                        .
                    </>
                ) : null}
            </p>
            <p>{retentionNotice(form.retention_days)}</p>
        </section>
    );
}
