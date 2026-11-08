// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import { notifyError } from "@/app/lib/userFacingError";
import {
    createIntakeRequest,
    type RequestDeskPriority,
    type RequestDeskRequest,
} from "@/app/lib/mikeApi";
import { PRIORITY_ORDER, priorityLabel } from "./intakeLabels";

export interface NewRequestModalProps {
    open: boolean;
    workspace: string;
    onClose: () => void;
    /** The logged request, so the board can refresh and open it. */
    onCreated: (request: RequestDeskRequest) => void;
}

/** Mount the form only while open so each open starts from a blank request. */
export function NewRequestModal(props: NewRequestModalProps) {
    return props.open ? <NewRequestForm {...props} /> : null;
}

function NewRequestForm({ open, workspace, onClose, onCreated }: NewRequestModalProps) {
    const [title, setTitle] = useState("");
    const [details, setDetails] = useState("");
    const [requestType, setRequestType] = useState("");
    const [priority, setPriority] = useState<RequestDeskPriority>("normal");
    const [requesterName, setRequesterName] = useState("");
    const [requesterEmail, setRequesterEmail] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [assigneeEmail, setAssigneeEmail] = useState("");
    const [saving, setSaving] = useState(false);

    const formId = "new-request-form";
    const trimmedTitle = title.trim();

    async function submit() {
        if (!trimmedTitle || saving) return;
        setSaving(true);
        try {
            const request = await createIntakeRequest(workspace, {
                title: trimmedTitle,
                details: details.trim(),
                request_type: requestType.trim() || null,
                priority,
                requester_name: requesterName.trim() || null,
                requester_email: requesterEmail.trim() || null,
                sla_due_at: dueDate || null,
                assignee_email: assigneeEmail.trim() || null,
            });
            // Only on success: the modal closes. A failure keeps everything
            // typed so nothing has to be entered twice.
            onCreated(request);
        } catch (error) {
            notifyError(error, {
                action: "log the request",
                operation: "intake.requests",
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
            breadcrumbs={["Intake", "New request"]}
            cancelAction={{ label: "Cancel", onClick: onClose, disabled: saving }}
            primaryAction={{
                label: saving ? "Logging…" : "Log request",
                type: "submit",
                form: formId,
                disabled: !trimmedTitle || saving,
            }}
        >
            <form
                id={formId}
                className="space-y-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <div>
                    <FieldLabel htmlFor="new-request-title">Title</FieldLabel>
                    <FormTextInput
                        id="new-request-title"
                        type="text"
                        autoFocus
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Short summary of the request"
                    />
                </div>
                <div>
                    <FieldLabel htmlFor="new-request-details">Details</FieldLabel>
                    <ModalTextarea
                        id="new-request-details"
                        value={details}
                        onChange={(event) => setDetails(event.target.value)}
                        placeholder="What is being asked for, and any context"
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <FieldLabel htmlFor="new-request-type">Type</FieldLabel>
                        <FormTextInput
                            id="new-request-type"
                            type="text"
                            value={requestType}
                            onChange={(event) => setRequestType(event.target.value)}
                            placeholder="e.g. Contract review"
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor="new-request-priority">Priority</FieldLabel>
                        <ModalSelect
                            id="new-request-priority"
                            aria-label="Priority"
                            value={priority}
                            onChange={(value) =>
                                setPriority(value as RequestDeskPriority)
                            }
                            options={PRIORITY_ORDER.map((value) => ({
                                value,
                                label: priorityLabel(value),
                            }))}
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor="new-request-requester-name">
                            Requester name
                        </FieldLabel>
                        <FormTextInput
                            id="new-request-requester-name"
                            type="text"
                            value={requesterName}
                            onChange={(event) => setRequesterName(event.target.value)}
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor="new-request-requester-email">
                            Requester email
                        </FieldLabel>
                        <FormTextInput
                            id="new-request-requester-email"
                            type="email"
                            value={requesterEmail}
                            onChange={(event) => setRequesterEmail(event.target.value)}
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor="new-request-due">Due date</FieldLabel>
                        <FormTextInput
                            id="new-request-due"
                            type="date"
                            value={dueDate}
                            onChange={(event) => setDueDate(event.target.value)}
                        />
                    </div>
                    <div>
                        <FieldLabel htmlFor="new-request-assignee">
                            Assign to (email)
                        </FieldLabel>
                        <FormTextInput
                            id="new-request-assignee"
                            type="email"
                            value={assigneeEmail}
                            onChange={(event) => setAssigneeEmail(event.target.value)}
                            placeholder="A member of this organization"
                        />
                    </div>
                </div>
            </form>
        </Modal>
    );
}
