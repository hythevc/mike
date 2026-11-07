// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Circle, CircleCheck, X } from "lucide-react";
import {
    PERSONAL_WORKSPACE,
    useWorkspaceParam,
} from "@/app/contexts/WorkspaceContext";
import { useSampleMatter } from "@/app/hooks/useSampleMatter";
import { LIQUID_GLASS_SUBTLE_CLASS } from "@/shared/ui/LiquidGlassUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

export type FirstRunStep =
    | "sample-matter"
    | "ask-question"
    | "run-workflow"
    | "review-change"
    | "invite-colleague";

// Per-viewer only, and brand-neutral so it survives a rebrand and stays out of
// the legacy-brand sweep. Never read back by the server.
const PROGRESS_KEY = "first-run-progress-v1";
const DISMISSED_KEY = "first-run-dismissed-v1";

function readStringSet(key: string): Set<string> {
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
        // Private windows, blocked storage, or a value this code did not write:
        // treat progress as empty rather than let the checklist throw.
        return new Set();
    }
}

/** The first-run steps this viewer has completed, read from local storage. */
export function completedFirstRunSteps(): Set<FirstRunStep> {
    return readStringSet(PROGRESS_KEY) as Set<FirstRunStep>;
}

/**
 * Record a first-run step as done for this viewer. Exported so the surfaces
 * that own each step (chat citations, a workflow run, a tracked-change review)
 * can report completion as the user reaches them.
 */
export function markFirstRunStep(step: FirstRunStep): void {
    try {
        const done = completedFirstRunSteps();
        if (done.has(step)) return;
        done.add(step);
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
    } catch {
        // No storage: the step simply shows as not done next time.
    }
}

function readDismissed(): boolean {
    try {
        return window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

interface StepCopy {
    id: FirstRunStep;
    title: string;
    hint: string;
    orgOnly?: boolean;
}

const STEPS: readonly StepCopy[] = [
    {
        id: "sample-matter",
        title: "Open the sample matter",
        hint: "Public contract templates to try everything on — not client data.",
    },
    {
        id: "ask-question",
        title: "Ask a question and see a quote marked found",
        hint: "Each answer shows the source text it quotes, with a plain status.",
    },
    {
        id: "run-workflow",
        title: "Run a workflow on a document",
        hint: "Pick a document and a workflow to produce a first draft.",
    },
    {
        id: "review-change",
        title: "Review a tracked change",
        hint: "The assistant proposes edits; you decide on each one.",
    },
    {
        id: "invite-colleague",
        title: "Invite a colleague",
        hint: "They'll see the invitation when they open the app; no email is sent.",
        orgOnly: true,
    },
];

/**
 * A short first-run guide shown on the empty assistant home. Its first step
 * opens a ready sample matter built from public templates; the rest point at
 * the activation path. Progress is per-viewer: the sample-matter step is
 * recorded when it opens, and the others when their own surface reports them.
 */
export function FirstRunChecklist() {
    const workspace = useWorkspaceParam();
    const inOrganization =
        workspace !== undefined && workspace !== PERSONAL_WORKSPACE;
    const steps = STEPS.filter((step) => !step.orgOnly || inOrganization);

    const [completed, setCompleted] = useState<Set<FirstRunStep>>(
        () => new Set(),
    );
    const [dismissed, setDismissed] = useState(false);

    // Read per-viewer state after mount so server and client render the same
    // first paint (local storage is client-only; reading it during render
    // would mismatch hydration).
    /* eslint-disable react-hooks/set-state-in-effect -- initialize client-only state from local storage after mount */
    useEffect(() => {
        setCompleted(completedFirstRunSteps());
        setDismissed(readDismissed());
    }, []);
    /* eslint-enable react-hooks/set-state-in-effect */

    const { pending, openSampleMatter } = useSampleMatter(
        useCallback(() => {
            markFirstRunStep("sample-matter");
            setCompleted(completedFirstRunSteps());
        }, []),
    );

    const dismiss = useCallback(() => {
        try {
            window.localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
            // Nothing persisted; the card still closes for this view.
        }
        setDismissed(true);
    }, []);

    const doneCount = steps.filter((step) => completed.has(step.id)).length;
    if (dismissed || doneCount === steps.length) return null;

    return (
        <section
            aria-label="Get started"
            className={`mx-auto w-full max-w-xl rounded-2xl px-5 py-4 ${LIQUID_GLASS_SUBTLE_CLASS}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-medium text-gray-900">
                        Get started
                    </h2>
                    <p className="mt-0.5 text-xs text-gray-600">
                        {doneCount} of {steps.length} done
                    </p>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss the get-started guide"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <ol className="mt-3 flex flex-col gap-3">
                {steps.map((step) => {
                    const isDone = completed.has(step.id);
                    return (
                        <li key={step.id} className="flex items-start gap-2.5">
                            {isDone ? (
                                <CircleCheck
                                    className="mt-0.5 h-4 w-4 shrink-0 text-gray-900"
                                    aria-hidden="true"
                                />
                            ) : (
                                <Circle
                                    className="mt-0.5 h-4 w-4 shrink-0 text-gray-300"
                                    aria-hidden="true"
                                />
                            )}
                            <div className="min-w-0">
                                <p className="text-sm text-gray-900">
                                    <span className="sr-only">
                                        {isDone ? "Done: " : "To do: "}
                                    </span>
                                    {step.title}
                                </p>
                                <p className="text-xs text-gray-600">
                                    {step.hint}
                                </p>
                                {step.id === "sample-matter" && (
                                    <PillButtonUI
                                        tone="black"
                                        size="sm"
                                        className="mt-2"
                                        loading={pending}
                                        disabled={pending}
                                        onClick={openSampleMatter}
                                    >
                                        {pending
                                            ? "Opening sample matter…"
                                            : "Try a sample matter"}
                                    </PillButtonUI>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
