// SPDX-License-Identifier: AGPL-3.0-only
//
// Operator-stated facts for the public security page that the code cannot
// know by itself. Everything else on /security describes what the software
// does and is written in security.md; this file holds what a deployment has
// had checked from outside. It ships empty on purpose: until an operator
// records an assessment here, the page says that none exists.

/** One independent assessment of a deployment, as the operator records it. */
export interface IndependentAssessment {
    /** What was assessed, for example a named framework or a penetration test. */
    readonly name: string;
    /** Who performed it. */
    readonly assessor: string;
    /** When it was completed, as an ISO date (YYYY-MM-DD) or a month. */
    readonly completed: string;
    /** What it covered, in one sentence. */
    readonly scope: string;
}

/**
 * The deployment's independent assessments. Empty until the operator has
 * one to show; the page then states that plainly rather than implying one.
 */
export const INDEPENDENT_ASSESSMENTS: readonly IndependentAssessment[] = [];

/** What the page says while no assessment is recorded. */
export const NO_INDEPENDENT_CERTIFICATION =
    "No independent certification yet. This service has not been certified or audited by an outside party, and the statements on this page describe what the software does rather than an attestation by anyone else.";

/**
 * The paragraph the security page shows under its certification heading: the
 * plain statement that none exists, or a list of the recorded assessments.
 */
export function certificationStatement(
    assessments: readonly IndependentAssessment[] = INDEPENDENT_ASSESSMENTS,
): string {
    if (assessments.length === 0) return NO_INDEPENDENT_CERTIFICATION;
    return assessments
        .map(
            (item) =>
                `- **${item.name}** by ${item.assessor}, completed ${item.completed}: ${item.scope}`,
        )
        .join("\n");
}
