// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId, useState } from "react";
import type { RequestDeskFormLink } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { CloseButton } from "@/shared/ui/CloseButton";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { requestFormUrl } from "./requestFormLabels";

export interface RequestFormLinkNoticeProps {
    link: RequestDeskFormLink;
    onDismiss: () => void;
}

/**
 * The link a form was just created or re-issued with. It is shown this once:
 * the server keeps only a digest of the token, so once the notice is closed
 * the link can only be replaced, never shown again.
 */
export function RequestFormLinkNotice({ link, onDismiss }: RequestFormLinkNoticeProps) {
    const id = useId();
    const [copied, setCopied] = useState(false);
    const url = requestFormUrl(link.path);

    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch (error) {
            notifyError(error, { action: "copy the form link" });
        }
    }

    return (
        <GlassCardUI>
            <div role="status" className="relative space-y-3 p-4 pr-10">
                <CloseButton
                    onClick={onDismiss}
                    label="Dismiss the form link"
                    size="sm"
                    className="absolute right-3 top-3"
                />
                <div>
                    <h2 className="text-sm font-semibold text-fg">
                        Form link for {link.form.title}
                    </h2>
                    <p className="mt-1 text-xs text-fg-muted">
                        Shown once. Copy it now and share it with the people who may submit
                        requests. If it is lost, replace the link from the form.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor={id} className="sr-only">
                        Form link
                    </label>
                    <input
                        id={id}
                        readOnly
                        value={url}
                        onFocus={(event) => event.currentTarget.select()}
                        className={`${FORM_CONTROL_GLASS_CLASS} h-9 font-mono text-xs`}
                    />
                    <PillButtonUI tone="black" size="sm" onClick={() => void copy()}>
                        {copied ? "Copied" : "Copy link"}
                    </PillButtonUI>
                </div>
            </div>
        </GlassCardUI>
    );
}
