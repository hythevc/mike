// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { FieldLabel, FORM_CONTROL_GLASS_CLASS, FormTextInput } from "@/app/components/ui/form-field";
import { describeError, errorCode } from "@/app/lib/userFacingError";
import {
    submitPublicRequestForm,
    type RequestDeskFormReceipt,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { cn } from "@/app/lib/utils";
import { RequestFormNotices } from "./RequestFormNotices";
import {
    ALL_FIELDS_REQUIRED,
    FIELD_ERROR_PREFIX,
    INVALID_EMAIL_ERROR,
    REQUEST_FIELD_COPY,
    REQUEST_FIELD_ERRORS,
    REQUEST_FIELD_MAX,
    REQUEST_FIELD_ORDER,
    REQUEST_NOT_SENT_TITLE,
    SENDING_REQUEST_LABEL,
    SEND_REQUEST_LABEL,
    WORK_EMAIL_HINT,
    currentLengthNote,
    fieldsToCorrectLead,
    type RequestFieldName,
} from "./requestFormLabels";

export interface RequestSubmissionFormProps {
    token: string;
    form: RequestDeskPublicForm;
    onSubmitted: (receipt: RequestDeskFormReceipt) => void;
}

export type RequestFieldValues = Record<RequestFieldName, string>;
export type RequestFieldErrors = Partial<Record<RequestFieldName, string>>;

/**
 * The slot the page's one action carries (Send, or Try again when the form
 * did not load), the same name the public site's pages use for theirs. The
 * browser suite finds it by this slot to check its size at phone widths.
 */
export const REQUEST_PRIMARY_ACTION_SLOT = "primary-action";

/** The same shape of address the server accepts. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server's code for an address outside a form's approved domains. */
const SENDER_NOT_ALLOWED_CODE = "request_form_sender_not_allowed";

const EMPTY_VALUES: RequestFieldValues = { title: "", details: "", name: "", email: "" };

/**
 * What is wrong with what was typed, by field, in the server's own words;
 * empty when the request can be sent. Values are judged as they will be
 * sent, with the spaces around them removed.
 */
export function validateRequestFields(values: RequestFieldValues): RequestFieldErrors {
    const errors: RequestFieldErrors = {};
    for (const field of REQUEST_FIELD_ORDER) {
        const value = values[field].trim();
        if (!value) {
            errors[field] = REQUEST_FIELD_ERRORS[field].missing;
        } else if (value.length > REQUEST_FIELD_MAX[field]) {
            errors[field] =
                `${REQUEST_FIELD_ERRORS[field].tooLong} ${currentLengthNote(value.length)}`;
        } else if (field === "email" && !EMAIL_PATTERN.test(value)) {
            errors[field] = INVALID_EMAIL_ERROR;
        }
    }
    return errors;
}

/** What the last attempt to send reported: the fields to correct, or why it failed. */
interface AttemptSummary {
    fields: { field: RequestFieldName; message: string }[];
    message: string | null;
}

/** One field: its label, its hint, the control, and its message when it has one. */
function RequestField({
    name,
    controlId,
    hint,
    hintId,
    error,
    errorId,
    children,
}: {
    name: RequestFieldName;
    controlId: string;
    hint: string | null;
    hintId: string;
    error: string | undefined;
    errorId: string;
    children: ReactNode;
}) {
    return (
        <div data-request-field={name}>
            <FieldLabel htmlFor={controlId}>{REQUEST_FIELD_COPY[name].label}</FieldLabel>
            {hint ? (
                <p id={hintId} className="-mt-1 mb-2 text-xs leading-5 text-fg-muted">
                    {hint}
                </p>
            ) : null}
            {children}
            {error ? (
                <p
                    id={errorId}
                    className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-danger"
                >
                    <CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        <span className="sr-only">{FIELD_ERROR_PREFIX} </span>
                        {error}
                    </span>
                </p>
            ) : null}
        </div>
    );
}

/**
 * The fields a requester fills in, the notices to read, and the Send button.
 *
 * The button is always enabled: pressing it is how a requester finds out
 * what is missing. Checks run when the form is submitted, not while typing.
 * When something has to be corrected, a summary at the top takes focus and
 * links to each field, and each field shows its own message, tied to it with
 * `aria-describedby`. A message leaves its field as soon as the field is
 * edited; the summary stays until the next attempt, as the record of the last
 * one. Everything typed stays in place, nothing is cut to fit and paste is
 * never blocked: a value that is too long is reported, with its length. The
 * server has the last word, and its correction is shown the same way. The
 * hidden "website" field is the honeypot: a person never sees or fills it, a
 * robot does.
 */
export function RequestSubmissionForm({ token, form, onSubmitted }: RequestSubmissionFormProps) {
    const ids = useId();
    const [values, setValues] = useState<RequestFieldValues>(EMPTY_VALUES);
    const [website, setWebsite] = useState("");
    const [errors, setErrors] = useState<RequestFieldErrors>({});
    const [summary, setSummary] = useState<AttemptSummary | null>(null);
    // Counts failed attempts, so a second failure moves focus to the summary again.
    const [failedAttempts, setFailedAttempts] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const summaryRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (failedAttempts > 0) summaryRef.current?.focus();
    }, [failedAttempts]);

    const fieldId = (field: RequestFieldName) => `${ids}-${field}`;
    const errorId = (field: RequestFieldName) => `${ids}-${field}-error`;
    const hintId = (field: RequestFieldName) => `${ids}-${field}-hint`;

    function hintFor(field: RequestFieldName): string | null {
        if (field === "email" && form.restricts_sender_domains) return WORK_EMAIL_HINT;
        return REQUEST_FIELD_COPY[field].hint;
    }

    /** What every control carries: its name, value, state and descriptions. */
    function controlProps(field: RequestFieldName) {
        // The ids that describe a field: its hint, then its message.
        const describedBy = [
            hintFor(field) ? hintId(field) : null,
            errors[field] ? errorId(field) : null,
        ].filter(Boolean);
        return {
            id: fieldId(field),
            name: field,
            required: true,
            value: values[field],
            "aria-invalid": errors[field] ? (true as const) : undefined,
            "aria-describedby": describedBy.length > 0 ? describedBy.join(" ") : undefined,
        };
    }

    function fieldProps(field: RequestFieldName) {
        return {
            name: field,
            controlId: fieldId(field),
            hint: hintFor(field),
            hintId: hintId(field),
            error: errors[field],
            errorId: errorId(field),
        };
    }

    function update(field: RequestFieldName, value: string) {
        setValues((current) => ({ ...current, [field]: value }));
        setErrors((current) => {
            if (!current[field]) return current;
            const next = { ...current };
            delete next[field];
            return next;
        });
    }

    /** Take the requester from the summary to a field, with its label in view. */
    function goToField(field: RequestFieldName) {
        const control = document.getElementById(fieldId(field));
        if (!control) return;
        // jsdom has no scrollIntoView; a browser always does.
        control
            .closest("[data-request-field]")
            ?.scrollIntoView?.({ block: "nearest" });
        control.focus({ preventScroll: true });
    }

    function reportFailure(next: AttemptSummary, fieldErrors: RequestFieldErrors) {
        setErrors(fieldErrors);
        setSummary(next);
        setFailedAttempts((count) => count + 1);
    }

    async function submit() {
        if (submitting) return;
        const found = validateRequestFields(values);
        const invalid = REQUEST_FIELD_ORDER.filter((field) => found[field]);
        if (invalid.length > 0) {
            reportFailure(
                {
                    fields: invalid.map((field) => ({ field, message: found[field]! })),
                    message: null,
                },
                found,
            );
            return;
        }

        setSubmitting(true);
        try {
            const receipt = await submitPublicRequestForm(token, {
                title: values.title.trim(),
                details: values.details.trim(),
                requester_name: values.name.trim(),
                requester_email: values.email.trim(),
                website,
            });
            onSubmitted(receipt);
        } catch (caught) {
            const message = describeError(caught, { action: "send your request" }).message;
            if (errorCode(caught) === SENDER_NOT_ALLOWED_CODE) {
                // The one server correction that belongs to a field.
                reportFailure(
                    { fields: [{ field: "email", message }], message: null },
                    { email: message },
                );
            } else {
                reportFailure({ fields: [], message }, {});
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form
            className="space-y-5"
            noValidate
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            {summary ? (
                <div
                    ref={summaryRef}
                    tabIndex={-1}
                    data-slot="request-error-summary"
                    className="rounded-xl border border-danger p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
                >
                    <div role="alert">
                        <h2 className="text-sm font-medium text-fg">{REQUEST_NOT_SENT_TITLE}</h2>
                        {summary.message ? (
                            <p className="mt-1 text-sm leading-6 text-fg-subtle">
                                {summary.message}
                            </p>
                        ) : null}
                        {summary.fields.length > 0 ? (
                            <>
                                <p className="mt-1 text-sm leading-6 text-fg-subtle">
                                    {fieldsToCorrectLead(summary.fields.length)}
                                </p>
                                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 marker:text-fg-muted">
                                    {summary.fields.map((item) => (
                                        <li key={item.field}>
                                            <a
                                                href={`#${fieldId(item.field)}`}
                                                className="rounded-sm font-medium text-danger underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    goToField(item.field);
                                                }}
                                            >
                                                {item.message}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <p className="text-xs text-fg-muted">{ALL_FIELDS_REQUIRED}</p>

            <RequestField {...fieldProps("title")}>
                <FormTextInput
                    {...controlProps("title")}
                    type="text"
                    autoComplete="off"
                    onChange={(event) => update("title", event.target.value)}
                />
            </RequestField>
            <RequestField {...fieldProps("details")}>
                <textarea
                    {...controlProps("details")}
                    rows={6}
                    autoComplete="off"
                    className={cn(FORM_CONTROL_GLASS_CLASS, "min-h-32 resize-y py-2.5 leading-relaxed")}
                    onChange={(event) => update("details", event.target.value)}
                />
            </RequestField>
            {/* The two short answers are as wide as what goes in them. */}
            <RequestField {...fieldProps("name")}>
                <FormTextInput
                    {...controlProps("name")}
                    type="text"
                    autoComplete="name"
                    className="max-w-md"
                    onChange={(event) => update("name", event.target.value)}
                />
            </RequestField>
            <RequestField {...fieldProps("email")}>
                <FormTextInput
                    {...controlProps("email")}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="max-w-md"
                    onChange={(event) => update("email", event.target.value)}
                />
            </RequestField>
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

            <div className="border-t border-border pt-5">
                <RequestFormNotices form={form} />
            </div>

            <div className="flex justify-end">
                <PillButtonUI
                    type="submit"
                    tone="black"
                    size="normal"
                    data-slot={REQUEST_PRIMARY_ACTION_SLOT}
                    className="h-11 w-full px-5 sm:w-auto"
                    loading={submitting}
                >
                    {submitting ? SENDING_REQUEST_LABEL : SEND_REQUEST_LABEL}
                </PillButtonUI>
            </div>
        </form>
    );
}
