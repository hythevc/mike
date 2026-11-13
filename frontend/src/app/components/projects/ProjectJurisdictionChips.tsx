// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { JurisdictionChips } from "@/app/components/jurisdictions/JurisdictionChips";
import { useJurisdictionRegistry } from "@/app/hooks/useJurisdictionRegistry";

/**
 * The matter's jurisdictions under the project header, one chip each, so the
 * law a project is about is in view on every one of its pages. Render it only
 * for a project that has jurisdictions: with none it draws nothing, and it
 * reads the registry only once it is on the page.
 *
 * The chips carry names, which come from the registry. While that is on its
 * way the row holds its place with as many placeholders as there are chips;
 * if it cannot be read, the codes themselves are shown.
 */
export function ProjectJurisdictionChips({
    codes,
}: {
    codes: readonly string[];
}) {
    const { registry, error } = useJurisdictionRegistry();
    if (codes.length === 0) return null;

    return (
        <div
            data-slot="project-jurisdiction-chips"
            // The header's gutters, tucked up under its title row. It keeps
            // its height when the page below it is taller than the window.
            className="mx-3 -mt-2 mb-3 flex min-w-0 shrink-0 md:mx-6.5"
        >
            {registry || error ? (
                <JurisdictionChips
                    codes={codes}
                    entries={registry?.jurisdictions ?? []}
                    label="Jurisdictions of this project"
                />
            ) : (
                <div aria-hidden="true" className="flex flex-wrap gap-1.5">
                    {codes.map((code) => (
                        <span
                            key={code}
                            className="h-6 w-20 animate-pulse rounded-full bg-app-surface-active"
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
