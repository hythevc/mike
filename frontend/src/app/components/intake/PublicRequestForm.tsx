// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    MikeApiError,
    getPublicRequestForm,
    type RequestDeskFormReceipt,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import { reportFault } from "@/app/lib/userFacingError";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { RequestFormNotices } from "./RequestFormNotices";
import { RequestSubmissionForm } from "./RequestSubmissionForm";
import {
    FORM_UNAVAILABLE_MESSAGE,
    FORM_UNAVAILABLE_TITLE,
    RECEIPT_KEEP_REFERENCE,
    RECEIPT_TITLE,
} from "./requestFormLabels";

type State =
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "failed" }
    | { kind: "ready"; form: RequestDeskPublicForm }
    | { kind: "submitted"; form: RequestDeskPublicForm; receipt: RequestDeskFormReceipt };

/**
 * The public request form, reached by its link and rendered without a
 * session: the organization's name and logo, its notices, the form, and the
 * receipt. An unknown, disabled or replaced link shows one notice, the same
 * for all three; a failed load says so and offers Retry.
 */
export function PublicRequestForm({ token }: { token: string }) {
    const [state, setState] = useState<State>({ kind: "loading" });
    const [reloadKey, setReloadKey] = useState(0);
    const receiptHeading = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        const controller = new AbortController();
        /* eslint-disable react-hooks/set-state-in-effect -- show the loading
           state while the form is fetched, also on a retry */
        setState({ kind: "loading" });
        /* eslint-enable react-hooks/set-state-in-effect */
        (async () => {
            try {
                const form = await getPublicRequestForm(token, controller.signal);
                if (!controller.signal.aborted) setState({ kind: "ready", form });
            } catch (caught) {
                if (controller.signal.aborted) return;
                if (caught instanceof MikeApiError && caught.status === 404) {
                    setState({ kind: "unavailable" });
                    return;
                }
                setState({ kind: "failed" });
                reportFault(caught, {
                    action: "load the request form",
                    operation: "request_form.read",
                });
            }
        })();
        return () => controller.abort();
    }, [token, reloadKey]);

    const onSubmitted = useCallback((receipt: RequestDeskFormReceipt) => {
        setState((current) =>
            current.kind === "ready" || current.kind === "submitted"
                ? { kind: "submitted", form: current.form, receipt }
                : current,
        );
    }, []);

    // The receipt is the one thing to read next, so focus moves to it.
    useEffect(() => {
        if (state.kind === "submitted") receiptHeading.current?.focus();
    }, [state.kind]);

    if (state.kind === "loading") {
        return (
            <div aria-busy="true" aria-live="polite" className="space-y-4">
                <p className="text-sm text-fg-muted">Loading the request form…</p>
                <div className="h-6 w-48 animate-pulse rounded bg-surface" />
                <div className="h-40 animate-pulse rounded-xl bg-surface" />
            </div>
        );
    }

    if (state.kind === "unavailable") {
        return (
            <GlassCardUI>
                <div className="space-y-2 p-5">
                    <h1 className="text-xl font-medium text-fg">{FORM_UNAVAILABLE_TITLE}</h1>
                    <p className="text-sm text-fg-subtle">{FORM_UNAVAILABLE_MESSAGE}</p>
                </div>
            </GlassCardUI>
        );
    }

    if (state.kind === "failed") {
        return (
            <GlassCardUI>
                <div className="space-y-3 p-5">
                    <h1 className="text-xl font-medium text-fg">The request form did not load</h1>
                    <p className="text-sm text-fg-subtle">
                        Something went wrong on our side. Try again in a moment.
                    </p>
                    <PillButtonUI
                        tone="black"
                        size="sm"
                        onClick={() => setReloadKey((key) => key + 1)}
                    >
                        Try again
                    </PillButtonUI>
                </div>
            </GlassCardUI>
        );
    }

    const { form } = state;
    return (
        <div className="space-y-6">
            <header className="flex items-start gap-4">
                {form.organization.logo_data_url ? (
                    // The organization's own mark, not the product's.
                    // eslint-disable-next-line @next/next/no-img-element -- a data URL from the API, not a static asset
                    <img
                        src={form.organization.logo_data_url}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg object-contain"
                    />
                ) : null}
                <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-fg-subtle [overflow-wrap:anywhere]">
                        {form.organization.name}
                    </p>
                    <h1 className="text-2xl font-medium text-fg [overflow-wrap:anywhere]">
                        {form.title}
                    </h1>
                    {form.intro ? (
                        <p className="whitespace-pre-wrap text-sm text-fg-subtle">{form.intro}</p>
                    ) : null}
                </div>
            </header>

            <GlassCardUI>
                <div className="relative p-5">
                    {state.kind === "submitted" ? (
                        <section aria-labelledby="request-form-receipt" className="space-y-3">
                            <h2
                                id="request-form-receipt"
                                ref={receiptHeading}
                                tabIndex={-1}
                                className="text-lg font-medium text-fg focus-visible:outline-none"
                            >
                                {RECEIPT_TITLE}
                            </h2>
                            <p className="text-sm text-fg">
                                Your reference is{" "}
                                <strong className="font-semibold tabular-nums">
                                    {state.receipt.reference}
                                </strong>
                                .
                            </p>
                            <p className="text-sm text-fg-subtle">{RECEIPT_KEEP_REFERENCE}</p>
                        </section>
                    ) : (
                        <RequestSubmissionForm token={token} form={form} onSubmitted={onSubmitted} />
                    )}
                </div>
            </GlassCardUI>

            <RequestFormNotices form={form} />
        </div>
    );
}
