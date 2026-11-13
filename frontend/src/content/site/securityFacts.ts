// SPDX-License-Identifier: AGPL-3.0-only
//
// The security facts of a deployment, each stated once.
//
//   - The facts with a status: what the software does today ("in place") or
//     will do by a stated date ("planned"). The public security page lists
//     all of them in its summary, and the pricing page shows a few of them
//     under its one action. Both pages print the same sentence for a fact,
//     taken from here, so they cannot come to say different things.
//   - INDEPENDENT_ASSESSMENTS: what a deployment has had checked from
//     outside, which the code cannot know by itself. It ships empty on
//     purpose: until an operator records an assessment here, both pages say
//     that none exists.
//
// Everything else on /security is written in security.md. A fact belongs in
// this file only while it is literally true of the running service. One that
// is not true yet is "planned" and must say when it is due.

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

// ---------------------------------------------------------------------------
// Facts with a status
// ---------------------------------------------------------------------------

/**
 * "in place": the running service does this today. "planned": it does not
 * yet, and the fact says when it is due.
 */
export type SecurityFactStatus = "in place" | "planned";

interface SecurityFactText {
    /** Stable identifier: the list key, and how the pricing page picks a line. */
    readonly id: string;
    /**
     * The fact as one sentence, ending in a full stop. A planned fact is
     * written as what will be true ("An outside firm tests the service once
     * a year."); the pages put "Planned for <date>:" in front of it.
     */
    readonly text: string;
}

/**
 * One security fact. A planned fact carries the date it is due (`YYYY-MM`
 * or `YYYY-MM-DD`), and only a planned fact carries one, so "planned" can
 * never reach a reader without a date. A fact with no status is a plain
 * statement, such as there being no independent assessment yet.
 */
export type SecurityFact = SecurityFactText &
    (
        | { readonly status: "in place"; readonly date?: undefined }
        | { readonly status: "planned"; readonly date: string }
        | { readonly status?: undefined; readonly date?: undefined }
    );

/**
 * What the software does, each line checked against security.md and the
 * code behind it. Add a fact only when it is true of the running service;
 * add one that is not true yet as `status: "planned"` with the `date` it is
 * due, and change it to "in place" when it ships.
 */
const SOFTWARE_FACTS: readonly SecurityFact[] = [
    {
        id: "provider-keys-encrypted",
        status: "in place",
        text: "Saved provider keys are encrypted with AES-256-GCM.",
    },
    {
        id: "multi-factor-authentication",
        status: "in place",
        text: "Any account can add an authenticator app as a second factor.",
    },
    {
        id: "audit-log",
        status: "in place",
        text: "An audit log records who did what, and which documents the assistant read.",
    },
    {
        id: "matter-ai-switch",
        status: "in place",
        text: "AI can be switched off for a single matter.",
    },
    {
        id: "export-and-deletion",
        status: "in place",
        text: "You can export your data, or delete it, from Settings at any time.",
    },
    {
        id: "error-reporting-off",
        status: "in place",
        text: "Error reporting to an outside service is off unless the operator turns it on.",
    },
    {
        id: "source-public",
        status: "in place",
        text: "The complete source code of the running service is public.",
    },
];

/** The id of the fact that says whether anyone outside has assessed the service. */
export const INDEPENDENT_ASSESSMENT_FACT_ID = "independent-assessment";

function independentAssessmentFact(
    assessments: readonly IndependentAssessment[],
): SecurityFact {
    if (assessments.length === 0) {
        return {
            id: INDEPENDENT_ASSESSMENT_FACT_ID,
            text: "No outside party has certified or audited this service yet.",
        };
    }
    const names = assessments.map((item) => item.name).join(", ");
    return {
        id: INDEPENDENT_ASSESSMENT_FACT_ID,
        status: "in place",
        text: `Independent assessments on record: ${names}.`,
    };
}

/**
 * Every security fact, in the order the security page lists them: what the
 * software does, then whether anyone outside has assessed it.
 */
export function securityFacts(
    assessments: readonly IndependentAssessment[] = INDEPENDENT_ASSESSMENTS,
): readonly SecurityFact[] {
    return [...SOFTWARE_FACTS, independentAssessmentFact(assessments)];
}

/**
 * The facts the pricing page shows under its action, in order. Each id must
 * name a fact above; `trustStripFacts` throws on one that does not.
 */
export const TRUST_STRIP_FACT_IDS: readonly string[] = [
    "provider-keys-encrypted",
    "export-and-deletion",
    "source-public",
    INDEPENDENT_ASSESSMENT_FACT_ID,
];

/** The pricing page's facts: always a subset of `securityFacts()`. */
export function trustStripFacts(
    facts: readonly SecurityFact[] = securityFacts(),
    ids: readonly string[] = TRUST_STRIP_FACT_IDS,
): readonly SecurityFact[] {
    return ids.map((id) => {
        const fact = facts.find((candidate) => candidate.id === id);
        if (!fact) throw new Error(`Unknown security fact: ${id}`);
        return fact;
    });
}

// ---------------------------------------------------------------------------
// How a fact is shown
// ---------------------------------------------------------------------------

/** The words the pages put around the facts. */
export const SECURITY_FACTS_COPY = {
    inPlaceLead: "In place today:",
    plannedLead: "Not in place yet:",
    /** In front of a planned fact, so its date is the first thing read. */
    plannedPrefix: (date: string) => `Planned for ${date}:`,
} as const;

const PLANNED_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

function parsePlannedDate(
    value: string,
): { year: number; month: number; day: number | null } | null {
    const match = PLANNED_DATE.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] === undefined ? null : Number(match[3]);
    if (month < 1 || month > 12) return null;
    if (day !== null) {
        const date = new Date(Date.UTC(year, month - 1, day));
        // A day the month does not have rolls over into the next month.
        if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
            return null;
        }
    }
    return { year, month, day };
}

/**
 * A planned fact's date in words, in the language the pages are written in:
 * "March 2027" for a month, "March 15, 2027" for a day.
 */
export function plannedDateLabel(value: string): string {
    const parsed = parsePlannedDate(value);
    if (!parsed) throw new Error(`Not a planned date (YYYY-MM or YYYY-MM-DD): ${value}`);
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day ?? 1));
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        ...(parsed.day === null ? {} : { day: "numeric" }),
    }).format(date);
}

/**
 * A fact as both pages print it: its sentence, with "Planned for <date>:" in
 * front when it is not in place yet. The security page and the pricing page
 * both call this, so a fact reads the same wherever it appears.
 */
export function securityFactLine(fact: SecurityFact): string {
    return fact.status === "planned"
        ? `${SECURITY_FACTS_COPY.plannedPrefix(plannedDateLabel(fact.date))} ${fact.text}`
        : fact.text;
}

/**
 * Everything wrong with a list of facts, as sentences; empty when the list
 * may be published. A planned fact needs a date, only a planned fact may
 * carry one, and every fact needs its own id and a sentence. Pass `today`
 * to also refuse a planned date that has already passed: the test suite
 * does, so a fact cannot stay "planned" after its date, while a page request
 * never fails for that reason.
 */
export function securityFactProblems(
    facts: readonly SecurityFact[],
    options: { today?: Date } = {},
): string[] {
    const { today } = options;
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const fact of facts) {
        const name = fact.id || "(no id)";
        if (!fact.id.trim()) problems.push("A security fact has no id.");
        if (seen.has(fact.id)) problems.push(`${name}: the id is used twice.`);
        seen.add(fact.id);
        const text = fact.text.trim();
        if (!text) problems.push(`${name}: the text is empty.`);
        else if (!text.endsWith(".")) {
            problems.push(`${name}: the text must be a sentence ending in a full stop.`);
        }

        // Read loosely: the type forbids these shapes, but the list is edited
        // by hand and a test should say so in words when one slips through.
        const status = fact.status as string | undefined;
        const date = fact.date as string | undefined;
        if (status !== undefined && status !== "in place" && status !== "planned") {
            problems.push(`${name}: the status must be "in place" or "planned".`);
        }
        if (status === "planned") {
            if (!date) {
                problems.push(`${name}: a planned fact must carry the date it is due.`);
                continue;
            }
            const parsed = parsePlannedDate(date);
            if (!parsed) {
                problems.push(`${name}: the date must be YYYY-MM or YYYY-MM-DD.`);
                continue;
            }
            // A month is due until its last day; a day until that day.
            const due =
                parsed.day === null
                    ? Date.UTC(parsed.year, parsed.month, 1)
                    : Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1);
            if (today && due <= today.getTime()) {
                problems.push(
                    `${name}: its planned date has passed. Mark it "in place" once it is true, or give it a new date.`,
                );
            }
        } else if (date !== undefined) {
            problems.push(`${name}: only a planned fact may carry a date.`);
        }
    }
    return problems;
}

/**
 * The security page's summary as Markdown: the facts in place, the facts
 * planned with their dates, then the plain statements. Throws on a list
 * `securityFactProblems` would refuse, so a planned fact can never be
 * published without its date.
 */
export function securityFactsSummary(
    facts: readonly SecurityFact[] = securityFacts(),
): string {
    const problems = securityFactProblems(facts);
    if (problems.length > 0) {
        throw new Error(`The security facts cannot be published: ${problems.join(" ")}`);
    }
    const list = (items: readonly SecurityFact[]) =>
        items.map((fact) => `- ${securityFactLine(fact)}`).join("\n");
    const inPlace = facts.filter((fact) => fact.status === "in place");
    const planned = facts.filter((fact) => fact.status === "planned");
    const plain = facts.filter((fact) => fact.status === undefined);
    const blocks: string[] = [];
    if (inPlace.length > 0) {
        blocks.push(`${SECURITY_FACTS_COPY.inPlaceLead}\n\n${list(inPlace)}`);
    }
    if (planned.length > 0) {
        blocks.push(`${SECURITY_FACTS_COPY.plannedLead}\n\n${list(planned)}`);
    }
    blocks.push(...plain.map((fact) => fact.text));
    return blocks.join("\n\n");
}
