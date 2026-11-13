// SPDX-License-Identifier: AGPL-3.0-only
import type { JurisdictionEntry } from "@/app/lib/mikeApi";

/**
 * A jurisdiction's name. A code the registry does not hold is shown as the
 * code itself, so a value stored before the registry changed is still
 * visible, and removable, rather than silently missing.
 */
export function jurisdictionName(
    code: string,
    entries: readonly JurisdictionEntry[],
): string {
    return entries.find((entry) => entry.code === code)?.name ?? code;
}

/** `Name (CODE)`, the form used wherever the code itself is worth showing. */
export function jurisdictionLabel(
    code: string,
    entries: readonly JurisdictionEntry[],
): string {
    const entry = entries.find((candidate) => candidate.code === code);
    return entry ? `${entry.name} (${entry.code})` : code;
}
