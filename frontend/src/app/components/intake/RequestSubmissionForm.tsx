// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId, useState } from "react";
import { FieldLabel, FORM_CONTROL_GLASS_CLASS, FormTextInput } from "@/app/components/ui/form-field";
import { describeError } from "@/app/lib/userFacingError";
import {
    submitPublicRequestForm,
    type RequestDeskFormReceipt,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { cn } from "@/app/lib/utils";

export interface RequestSubmissionFormProps {
    token: string;
    form: RequestDeskPublicForm;
    onSubmitted: (receipt: RequestDeskFormReceipt) => void;
}

/**
 * The fields a requester fills in. Failures are shown inline beside the
 * form (the backend's 4xx detail says what to fix); everything typed stays
 * in place so nothing is entered twice. The hidden "website" field is the
 * honeypot: a person never sees or fills it, a robot does.
 */
export function RequestSubmissionForm({ token, form, onSubmitted }: RequestSubmissionFormProps) {
    const ids = useId();
    const [title, setTitle] = useState("");
    const [details, setDetails] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [website, setWebsite] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit =
        title.trim() !== "" && details.trim() !== "" && name.trim() !== "" && email.trim() !== "";

    async function submit() {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const receipt = await submitPublicRequestForm(token, {
                title: title.trim(),
                details: details.trim(),
                requester_name: name.trim(),
                requester_email: email.trim(),
                website,
            });
            onSubmitted(receipt);
        } catch (caught) {
            setError(describeError(caught, { action: "send your request" }).message);
        } finally {
            setSubmitting(false);
        }
    }

    const errorId = `${ids}-error`;
    return (
        <form
            className="space-y-4"
            noValidate
            aria-describedby={error ? errorId : undefined}
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div>
                <FieldLabel htmlFor={`${ids}-title`}>What is the request about?</FieldLabel>
                <FormTextInput
                    id={`${ids}-title`}
                    type="text"
                    required
                    maxLength={200}
                    autoComplete="off"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="A short title, for example: supplier contract review"
                />
            </div>
            <div>
                <FieldLabel htmlFor={`${ids}-details`}>Details</FieldLabel>
                <textarea
                    id={`${ids}-details`}
                    required
                    maxLength={10000}
                    rows={6}
                    className={cn(FORM_CONTROL_GLASS_CLASS, "min-h-32 resize-y py-2.5 leading-relaxed")}
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    placeholder="What you need, by when, and any background the legal team should know"
                />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <FieldLabel htmlFor={`${ids}-name`}>Your name</FieldLabel>
                    <FormTextInput
                        id={`${ids}-name`}
                        type="text"
                        required
                        maxLength={200}
                        autoComplete="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                </div>
                <div>
                    <FieldLabel htmlFor={`${ids}-email`}>Your email address</FieldLabel>
                    <FormTextInput
                        id={`${ids}-email`}
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        aria-describedby={form.restricts_sender_domains ? `${ids}-email-hint` : undefined}
                    />
                    {form.restricts_sender_domains ? (
                        <p id={`${ids}-email-hint`} className="mt-1 text-xs text-fg-muted">
                            Use your work email address. This form accepts requests from approved
                            domains only.
                        </p>
                    ) : null}
                </div>
            </div>
            {/* The honeypot: off screen and out of the tab order, named so a
                person who does reach it knows to leave it alone. */}
            <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor={`${ids}-website`}>Leave this field empty</label>
                <input
                    id={`${ids}-website`}
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                />
            </div>
            {error ? (
                <p id={errorId} role="alert" className="text-sm text-danger">
                    {error}
                </p>
            ) : null}
            <div className="flex items-center justify-end">
                <PillButtonUI
                    type="submit"
                    tone="black"
                    size="normal"
                    disabled={!canSubmit}
                    loading={submitting}
                >
                    {submitting ? "Sending…" : "Send request"}
                </PillButtonUI>
            </div>
        </form>
    );
}
