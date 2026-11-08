// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { EmptyState } from "@/app/components/ui/empty-state";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { notifyError, reportFault } from "@/app/lib/userFacingError";
import {
    listRequestForms,
    rotateRequestFormLink,
    updateRequestForm,
    type RequestDeskForm,
    type RequestDeskFormLink,
} from "@/app/lib/mikeApi";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { RequestFormCard } from "./RequestFormCard";
import { RequestFormEditorModal } from "./RequestFormEditorModal";
import { RequestFormLinkNotice } from "./RequestFormLinkNotice";

type Editor = { mode: "create" } | { mode: "edit"; form: RequestDeskForm } | null;
type Pending = { kind: "rotate" | "disable"; form: RequestDeskForm } | null;

/**
 * The organization's request forms, for its owners and admins: create one,
 * edit its notices and settings, replace its link, switch it off and on. A
 * new or replaced link is shown once, in the notice at the top.
 */
export function RequestFormsManager({ workspace }: { workspace: string }) {
    const router = useRouter();
    const [forms, setForms] = useState<RequestDeskForm[] | null>(null);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [editor, setEditor] = useState<Editor>(null);
    const [link, setLink] = useState<RequestDeskFormLink | null>(null);
    const [pending, setPending] = useState<Pending>(null);
    const [busy, setBusy] = useState<{ id: string; action: "rotate" | "toggle" } | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        // Show the loading state the moment the workspace changes or a retry
        // starts, before the request is sent.
        setForms(null);
        setError(false);
        (async () => {
            try {
                const page = await listRequestForms(workspace, controller.signal);
                if (!controller.signal.aborted) setForms(page.forms);
            } catch (caught) {
                if (controller.signal.aborted) return;
                setError(true);
                setForms([]);
                reportFault(caught, { action: "load the request forms", operation: "intake.forms" });
            }
        })();
        return () => controller.abort();
    }, [workspace, reloadKey]);

    const replaceForm = useCallback((saved: RequestDeskForm) => {
        setForms((current) =>
            current === null
                ? [saved]
                : current.some((form) => form.id === saved.id)
                  ? current.map((form) => (form.id === saved.id ? saved : form))
                  : [saved, ...current],
        );
    }, []);

    async function toggleEnabled(form: RequestDeskForm) {
        setBusy({ id: form.id, action: "toggle" });
        try {
            replaceForm(await updateRequestForm(form.id, { enabled: !form.enabled }));
        } catch (caught) {
            notifyError(caught, {
                action: form.enabled ? "switch the form off" : "switch the form on",
                operation: "intake.form",
            });
        } finally {
            setBusy(null);
        }
    }

    async function rotate(form: RequestDeskForm) {
        setBusy({ id: form.id, action: "rotate" });
        try {
            const rotated = await rotateRequestFormLink(form.id);
            replaceForm(rotated.form);
            setLink(rotated);
        } catch (caught) {
            notifyError(caught, { action: "replace the form link", operation: "intake.form.rotate" });
        } finally {
            setBusy(null);
        }
    }

    function confirmPending() {
        if (!pending) return;
        const { kind, form } = pending;
        setPending(null);
        if (kind === "rotate") void rotate(form);
        else void toggleEnabled(form);
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <PageHeader
                breadcrumbs={[
                    { label: "Intake", onClick: () => router.push("/intake"), title: "Back to Intake" },
                    { label: "Request forms" },
                ]}
                actions={[{ type: "new", title: "New form", onClick: () => setEditor({ mode: "create" }) }]}
            />
            {/* The breadcrumbs carry the visible title; this names the page for assistive technology. */}
            <h1 className="sr-only">Request forms</h1>
            <div className="mx-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6 md:mx-6.5">
                <p className="max-w-2xl text-xs text-fg-subtle">
                    A form link lets people without a seat, such as people at a client company or
                    business colleagues, send requests to this desk. Each request arrives on the
                    board with its reference; replies come from a person, outside this product.
                    Requesters see no AI output.
                </p>

                {link ? <RequestFormLinkNotice link={link} onDismiss={() => setLink(null)} /> : null}

                {forms === null ? (
                    <div aria-busy="true" className="space-y-3">
                        <div className="h-28 animate-pulse rounded-xl bg-surface" />
                        <div className="h-28 animate-pulse rounded-xl bg-surface" />
                    </div>
                ) : error ? (
                    <EmptyState
                        tone="error"
                        icon={<IntakeSkeuoIcon />}
                        title="The request forms did not load"
                        description="Something went wrong on our side. Try again in a moment."
                        action={
                            <PillButtonUI tone="black" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                                Try again
                            </PillButtonUI>
                        }
                    />
                ) : forms.length === 0 ? (
                    <EmptyState
                        icon={<IntakeSkeuoIcon />}
                        title="No request forms yet"
                        description="Create a form to get a link you can share with clients or colleagues who have no seat."
                        action={
                            <PillButtonUI tone="black" size="sm" onClick={() => setEditor({ mode: "create" })}>
                                New form
                            </PillButtonUI>
                        }
                    />
                ) : (
                    <ul className="space-y-3">
                        {forms.map((form) => (
                            <li key={form.id}>
                                <RequestFormCard
                                    form={form}
                                    busy={busy?.id === form.id ? busy.action : null}
                                    onEdit={() => setEditor({ mode: "edit", form })}
                                    onReplaceLink={() => setPending({ kind: "rotate", form })}
                                    onToggleEnabled={() =>
                                        form.enabled
                                            ? setPending({ kind: "disable", form })
                                            : void toggleEnabled(form)
                                    }
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <RequestFormEditorModal
                open={editor !== null}
                workspace={workspace}
                form={editor?.mode === "edit" ? editor.form : null}
                onClose={() => setEditor(null)}
                onSaved={(saved, created) => {
                    setEditor(null);
                    replaceForm(saved);
                    if (created) setLink(created);
                }}
            />

            <ConfirmPopup
                open={pending !== null}
                title={pending?.kind === "rotate" ? "Replace the form link?" : "Switch the form off?"}
                message={
                    pending?.kind === "rotate"
                        ? "The current link stops working at once, for everyone who has it. The new link is shown once; share it again."
                        : "The link stops working until the form is switched on again. Requests already submitted stay on the board."
                }
                confirmLabel={pending?.kind === "rotate" ? "Replace link" : "Switch off"}
                onConfirm={confirmPending}
                onCancel={() => setPending(null)}
            />
        </div>
    );
}
