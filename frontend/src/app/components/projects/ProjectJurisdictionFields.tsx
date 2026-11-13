// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMemo, useState } from "react";
import { JurisdictionMultiSelect } from "@/app/components/jurisdictions/JurisdictionMultiSelect";
import {
    ModalSelect,
    type ModalSelectOption,
} from "@/app/components/modals/ModalSelect";
import { FieldLabel } from "@/app/components/ui/form-field";
import { useJurisdictionRegistry } from "@/app/hooks/useJurisdictionRegistry";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";

const OPTION_NONE = "__none__";

/** A project's jurisdiction profile as the details form holds it. */
export type ProjectJurisdictionDraft = {
    jurisdictions: string[];
    governingLaw: string | null;
    workingLanguage: string | null;
};

/**
 * The three fields of a project's jurisdiction profile, beside its practice
 * in the details form: the jurisdictions the matter is about, the law that
 * governs it, and the language it is worked in. Each has a visible label.
 *
 * The choices come from the server's registry. Until it has loaded the
 * controls are in place but not usable; if it cannot be loaded, the form
 * says so and offers to try again, and what is already recorded stays shown.
 *
 * `readOnly` is for somebody who may see the profile but not change it.
 * `disabled` holds the fields for a moment, while the form is being saved,
 * without changing what they show.
 */
export function ProjectJurisdictionFields({
    idPrefix,
    value,
    onChange,
    disabled = false,
    readOnly = false,
}: {
    /** Prefix for the three control ids, e.g. `project-details`. */
    idPrefix: string;
    value: ProjectJurisdictionDraft;
    onChange: (next: ProjectJurisdictionDraft) => void;
    /** Held for now, e.g. while the form saves. */
    disabled?: boolean;
    /** The reader may not change the profile. */
    readOnly?: boolean;
}) {
    const { registry, error, retry } = useJurisdictionRegistry();
    const loading = !registry && !error;
    const unusable = disabled || readOnly || !registry;
    const entries = useMemo(() => registry?.jurisdictions ?? [], [registry]);

    // Which of the two single selects is open. Held here so that a press on
    // one while it cannot be used is forgotten: left to itself, the select
    // remembers the press and opens on its own once it can be used again.
    const [openSelect, setOpenSelect] = useState<
        "governing-law" | "working-language" | null
    >(null);
    const openStateOf = (name: NonNullable<typeof openSelect>) => ({
        open: !unusable && openSelect === name,
        onOpenChange: (open: boolean) =>
            setOpenSelect(open && !unusable ? name : null),
    });

    const governingLawOptions = useMemo<ModalSelectOption[]>(
        () => [
            { value: OPTION_NONE, label: "Not set" },
            ...entries.map((entry) => ({
                value: entry.code,
                label: entry.name,
                suffix: entry.code,
            })),
        ],
        [entries],
    );
    const workingLanguageOptions = useMemo<ModalSelectOption[]>(
        () => [
            { value: OPTION_NONE, label: "Not set" },
            ...(registry?.working_languages ?? []).map((language) => ({
                value: language.code,
                label: language.name,
            })),
        ],
        [registry],
    );
    const placeholder = loading ? "Loading..." : "Not set";

    return (
        <div
            data-slot="project-jurisdiction-fields"
            className="flex flex-col gap-6"
            aria-busy={loading}
        >
            <div>
                <FieldLabel htmlFor={`${idPrefix}-jurisdictions`}>
                    Jurisdictions
                </FieldLabel>
                <JurisdictionMultiSelect
                    id={`${idPrefix}-jurisdictions`}
                    value={value.jurisdictions}
                    onChange={(jurisdictions) =>
                        onChange({ ...value, jurisdictions })
                    }
                    options={entries}
                    max={registry?.max_jurisdictions ?? 10}
                    disabled={disabled}
                    // Without the registry there are no names to choose
                    // from, so what is recorded is shown and nothing more.
                    readOnly={readOnly || !registry}
                    emptyText={
                        readOnly
                            ? "No jurisdictions are recorded for this project."
                            : "No jurisdictions chosen. Choose the ones this project's work is about."
                    }
                />
            </div>

            <div>
                <FieldLabel htmlFor={`${idPrefix}-governing-law`}>
                    Governing law
                </FieldLabel>
                <ModalSelect
                    id={`${idPrefix}-governing-law`}
                    {...openStateOf("governing-law")}
                    value={value.governingLaw ?? (registry ? OPTION_NONE : "")}
                    options={governingLawOptions}
                    onChange={(code) =>
                        onChange({
                            ...value,
                            governingLaw: code === OPTION_NONE ? null : code,
                        })
                    }
                    placeholder={placeholder}
                    disabled={unusable}
                />
            </div>

            <div>
                <FieldLabel htmlFor={`${idPrefix}-working-language`}>
                    Working language
                </FieldLabel>
                <ModalSelect
                    id={`${idPrefix}-working-language`}
                    {...openStateOf("working-language")}
                    value={
                        value.workingLanguage ?? (registry ? OPTION_NONE : "")
                    }
                    options={workingLanguageOptions}
                    onChange={(code) =>
                        onChange({
                            ...value,
                            workingLanguage: code === OPTION_NONE ? null : code,
                        })
                    }
                    placeholder={placeholder}
                    disabled={unusable}
                />
            </div>

            {error ? (
                <p role="alert" className="text-xs text-danger">
                    The lists of jurisdictions and languages could not be
                    loaded, so these three fields cannot be changed yet.{" "}
                    <TextButtonUI
                        size="xs"
                        className="min-h-6 underline"
                        onClick={retry}
                    >
                        Try again
                    </TextButtonUI>
                </p>
            ) : null}
        </div>
    );
}
