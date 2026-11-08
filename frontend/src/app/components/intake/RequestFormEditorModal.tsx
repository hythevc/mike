// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Modal } from "@/app/components/modals/Modal";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import { notifyError } from "@/app/lib/userFacingError";
import {
    createRequestForm,
    updateRequestForm,
    type RequestDeskForm,
    type RequestDeskFormLink,
    type RequestFormInput,
} from "@/app/lib/mikeApi";

export interface RequestFormEditorModalProps {
    open: boolean;
    workspace: string;
    /** The form to edit, or null to create one. */
    form: RequestDeskForm | null;
    onClose: () => void;
    /** The saved form; `link` is set when a form was created. */
    onSaved: (form: RequestDeskForm, link: RequestDeskFormLink | null) => void;
}

/** Mount the fields only while open so each open starts from the form as it is. */
export function RequestFormEditorModal(props: RequestFormEditorModalProps) {
    return props.open ? <RequestFormEditor {...props} /> : null;
}

function RequestFormEditor({ open, workspace, form, onClose, onSaved }: RequestFormEditorModalProps) {
    const [title, setTitle] = useState(form?.title ?? "");
    const [intro, setIntro] = useState(form?.intro ?? "");
    const [disclaimer, setDisclaimer] = useState(form?.disclaimer ?? "");
    const [privacyNotice, setPrivacyNotice] = useState(form?.privacy_notice ?? "");
    const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(form?.privacy_policy_url ?? "");
    const [domains, setDomains] = useState(form?.allowed_sender_domains.join(", ") ?? "");
    const [retentionDays, setRetentionDays] = useState(String(form?.retention_days ?? 365));
    const [saving, setSaving] = useState(false);

    const formId = "request-form-editor";
    const creating = form === null;
    // A notice is edited, never emptied; on creation an empty one gets the
    // standard wording from the server.
    const canSave =
        !saving &&
        (creating || (title.trim() !== "" && disclaimer.trim() !== "" && privacyNotice.trim() !== ""));

    async function save() {
        if (!canSave) return;
        setSaving(true);
        const input: RequestFormInput = {
            title: title.trim(),
            intro: intro.trim(),
            disclaimer: disclaimer.trim(),
            privacy_notice: privacyNotice.trim(),
            privacy_policy_url: privacyPolicyUrl.trim() || null,
            allowed_sender_domains: domains,
            retention_days: Number(retentionDays),
        };
        try {
            if (creating) {
                const link = await createRequestForm(workspace, input);
                onSaved(link.form, link);
            } else {
                const saved = await updateRequestForm(form.id, input);
                onSaved(saved, null);
            }
        } catch (error) {
            // The modal stays open with everything typed in place.
            notifyError(error, {
                action: creating ? "create the request form" : "save the request form",
                operation: creating ? "intake.forms" : "intake.form",
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="md"
            className="h-auto"
            breadcrumbs={["Intake", "Request forms", creating ? "New form" : "Edit form"]}
            cancelAction={{ label: "Cancel", onClick: onClose, disabled: saving }}
            primaryAction={{
                label: saving ? "Saving…" : creating ? "Create form" : "Save changes",
                type: "submit",
                form: formId,
                disabled: !canSave,
            }}
        >
            <form
                id={formId}
                className="space-y-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <div>
                    <FieldLabel htmlFor={`${formId}-title`}>Title</FieldLabel>
                    <FormTextInput
                        id={`${formId}-title`}
                        type="text"
                        autoFocus
                        maxLength={120}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={creating ? "Legal request" : undefined}
                    />
                </div>
                <div>
                    <FieldLabel htmlFor={`${formId}-intro`}>Introduction (optional)</FieldLabel>
                    <ModalTextarea
                        id={`${formId}-intro`}
                        maxLength={2000}
                        value={intro}
                        onChange={(event) => setIntro(event.target.value)}
                        placeholder="What requesters should tell you, and what happens next"
                    />
                </div>
                <div>
                    <FieldLabel htmlFor={`${formId}-disclaimer`}>Disclaimer</FieldLabel>
                    <ModalTextarea
                        id={`${formId}-disclaimer`}
                        maxLength={2000}
                        value={disclaimer}
                        onChange={(event) => setDisclaimer(event.target.value)}
                        placeholder={creating ? "Leave empty to use the standard wording" : undefined}
                    />
                    <p className="mt-1 text-xs text-fg-muted">
                        Shown to every requester: that submitting does not create a lawyer-client
                        relationship and that a person replies.
                    </p>
                </div>
                <div>
                    <FieldLabel htmlFor={`${formId}-privacy`}>Privacy notice</FieldLabel>
                    <ModalTextarea
                        id={`${formId}-privacy`}
                        maxLength={2000}
                        value={privacyNotice}
                        onChange={(event) => setPrivacyNotice(event.target.value)}
                        placeholder={creating ? "Leave empty to use the standard wording" : undefined}
                    />
                    <p className="mt-1 text-xs text-fg-muted">
                        Who controls the personal data entered on the form and what it is used for.
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <FieldLabel htmlFor={`${formId}-privacy-url`}>Privacy policy link</FieldLabel>
                        <FormTextInput
                            id={`${formId}-privacy-url`}
                            type="url"
                            maxLength={500}
                            value={privacyPolicyUrl}
                            onChange={(event) => setPrivacyPolicyUrl(event.target.value)}
                            placeholder="https://"
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor={`${formId}-retention`}>Kept for (days)</FieldLabel>
                        <FormTextInput
                            id={`${formId}-retention`}
                            type="number"
                            min={1}
                            max={3650}
                            step={1}
                            value={retentionDays}
                            onChange={(event) => setRetentionDays(event.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <FieldLabel htmlFor={`${formId}-domains`}>Accept requests from these email domains</FieldLabel>
                    <FormTextInput
                        id={`${formId}-domains`}
                        type="text"
                        value={domains}
                        onChange={(event) => setDomains(event.target.value)}
                        placeholder="example.com, example.org"
                    />
                    <p className="mt-1 text-xs text-fg-muted">
                        Leave empty to accept any email address. Requesters never see this list.
                    </p>
                </div>
            </form>
        </Modal>
    );
}
