import { SvgAssetIcon } from "@/app/components/ui/svg-asset-icon";
import caseLaw from "../../../../../public/icons/legal-sources/case-law.svg";
import { Loader2 } from "lucide-react";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { displayCitationQuote, formatCitationPage } from "../../shared/types";
import type { Citation } from "../../shared/types";
import { CitationPillUI } from "@/shared/ui/CitationPillUI";
import { ANSWER_DISCLAIMER_TEXT } from "@/shared/ui/AnswerDisclaimerUI";
import { RESPONSE_GLASS_SURFACE } from "./messageStyles";
import {
    citationPageStatusNote,
    citationVerificationAriaLabel,
    citationVerificationDescription,
    citationVerificationPillClassName,
    citationVerificationState,
} from "./citationVerification";
import { QUOTE_NOT_FOUND_LABEL } from "./citationLabels";

type CitationSourceRow = {
    key: string;
    label: string;
    source: Citation;
    entries: { annotation: Citation; index: number }[];
};

function citationSourceKey(annotation: Citation): string {
    if (annotation.kind === "case") {
        return `case:${annotation.cluster_id}`;
    }
    return `document:${annotation.document_id}`;
}

function citationSourceLabel(annotation: Citation): string {
    if (annotation.kind === "case") {
        const caseName = annotation.case_name?.trim();
        const citation = annotation.citation?.trim();
        if (caseName && citation) return `${caseName}, ${citation}`;
        return caseName || citation || `Case ${annotation.cluster_id}`;
    }
    return annotation.filename;
}

export function citationTooltip(annotation: Citation): string {
    const locator = formatCitationPage(annotation);
    const quote = displayCitationQuote(annotation);
    const source = locator ? `${locator}: "${quote}"` : `"${quote}"`;
    const verification = citationVerificationDescription(annotation);
    // A page correction ("Quote is on p. 5, not p. 4") or "Page not checked".
    const pageNote = citationPageStatusNote(annotation);
    return [source, verification, pageNote]
        .filter(Boolean)
        .join(" — ");
}

function CitationSourceIcon({ annotation }: { annotation: Citation }) {
    if (annotation.kind === "case") {
        return (
            <SvgAssetIcon
                src={caseLaw}
                aria-hidden="true"
                width={14}
                height={14}
                className="h-3.5 w-3.5 shrink-0"
            />
        );
    }
    return (
        <FileTypeIcon fileType={annotation.filename} className="h-3.5 w-3.5" />
    );
}

function buildCitationSourceRows(citations: Citation[]): CitationSourceRow[] {
    const rows = new Map<string, CitationSourceRow>();
    citations.forEach((annotation, index) => {
        const key = citationSourceKey(annotation);
        const existing = rows.get(key);
        if (existing) {
            existing.entries.push({ annotation, index });
            return;
        }
        rows.set(key, {
            key,
            label: citationSourceLabel(annotation),
            source: annotation,
            entries: [{ annotation, index }],
        });
    });
    return Array.from(rows.values());
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function ensureTerminalPeriod(value: string): string {
    return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

export function buildCitationAppendix(citations: Citation[]) {
    // Every copied answer ends with the disclaimer, whether or not it cites.
    if (citations.length === 0) {
        return {
            html: `<p class="copied-disclaimer">${escapeHtmlText(ANSWER_DISCLAIMER_TEXT)}</p>`,
            text: `\n${ANSWER_DISCLAIMER_TEXT}`,
        };
    }
    let previousSourceKey: string | null = null;
    const entries = citations.map((annotation) => {
        const sourceKey = citationSourceKey(annotation);
        const label =
            sourceKey === previousSourceKey
                ? "Id."
                : citationSourceLabel(annotation);
        previousSourceKey = sourceKey;
        // The page (or Sheet!Cell) locator travels with the copied citation.
        // Case citations carry their reporter citation in the label already.
        const locator =
            annotation.kind === "case" ? "" : formatCitationPage(annotation);
        const status =
            citationVerificationState(annotation) === "unverified"
                ? QUOTE_NOT_FOUND_LABEL
                : citationPageStatusNote(annotation);
        return {
            number: annotation.ref,
            label,
            locator,
            quote: displayCitationQuote(annotation).trim(),
            status,
        };
    });
    const textLines = [
        "",
        "Citations",
        ...entries.map((entry) => {
            const locator = entry.locator ? ` ${entry.locator}.` : "";
            const quote = entry.quote ? ` "${entry.quote}"` : "";
            const status = entry.status ? ` [${entry.status}]` : "";
            return `${entry.number} ${ensureTerminalPeriod(entry.label)}${locator}${quote}${status}`;
        }),
        "",
        ANSWER_DISCLAIMER_TEXT,
    ];
    const html = [
        `<section class="copied-citations">`,
        `<h3>Citations</h3>`,
        ...entries.map((entry) => {
            const label = escapeHtmlText(ensureTerminalPeriod(entry.label));
            const locator = entry.locator
                ? ` ${escapeHtmlText(entry.locator)}.`
                : "";
            const quote = entry.quote
                ? ` &quot;${escapeHtmlText(entry.quote)}&quot;`
                : "";
            const status = entry.status
                ? ` [${escapeHtmlText(entry.status)}]`
                : "";
            return `<p><sup>${entry.number}</sup> ${label}${locator}${quote}${status}</p>`;
        }),
        `<p class="copied-disclaimer">${escapeHtmlText(ANSWER_DISCLAIMER_TEXT)}</p>`,
        `</section>`,
    ].join("");
    return { html, text: textLines.join("\n") };
}

export function CitationsBlock({
    citations,
    activeCitation,
    onCitationClick,
    onOpenSource,
    canOpenSource,
    showWhenEmpty = false,
    isLoading = false,
}: {
    citations: Citation[];
    activeCitation?: Citation | null;
    onCitationClick?: (citation: Citation) => void;
    onOpenSource?: (citation: Citation) => void;
    canOpenSource?: (citation: Citation) => boolean;
    showWhenEmpty?: boolean;
    isLoading?: boolean;
}) {
    const rows = buildCitationSourceRows(citations);
    if (rows.length === 0 && !showWhenEmpty) return null;

    return (
        <div className="mt-2 mb-3">
            <div className={`overflow-hidden ${RESPONSE_GLASS_SURFACE}`}>
                <div className="flex items-center justify-between gap-3 bg-white/25 px-3 py-2">
                    <h3 className="text-base font-serif text-gray-900">
                        Citations
                    </h3>
                    {isLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                    )}
                </div>
                <div>
                    {rows.map((row) => {
                        const sourceIsClickable =
                            !!onOpenSource &&
                            (canOpenSource?.(row.source) ?? true);
                        return (
                            <div
                                key={row.key}
                                className="flex items-start gap-3 px-3 py-3"
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenSource?.(row.source)}
                                    disabled={!sourceIsClickable}
                                    title={row.label}
                                    // The name takes whatever the pills leave and
                                    // wraps to two lines before truncating.
                                    className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left text-sm font-serif text-gray-700 transition-colors enabled:hover:text-gray-950 disabled:cursor-default"
                                >
                                    <span className="mt-[3px] flex shrink-0">
                                        <CitationSourceIcon
                                            annotation={row.source}
                                        />
                                    </span>
                                    <span className="line-clamp-2 [overflow-wrap:anywhere]">
                                        {row.label}
                                    </span>
                                </button>
                                {/* Only as wide as its pills, up to 60% of the
                                    row; beyond that the pills wrap, so every
                                    pill shows and the name keeps 40%. */}
                                <div className="flex max-w-[60%] shrink-0 flex-wrap justify-end gap-1">
                                    {row.entries.map(
                                        ({ annotation, index }) => (
                                            <CitationPillUI
                                                key={`${row.key}:${index}`}
                                                active={
                                                    activeCitation ===
                                                    annotation
                                                }
                                                onClick={() =>
                                                    onCitationClick?.(
                                                        annotation,
                                                    )
                                                }
                                                className={citationVerificationPillClassName(
                                                    annotation,
                                                )}
                                                aria-label={citationVerificationAriaLabel(
                                                    annotation,
                                                )}
                                                title={citationTooltip(
                                                    annotation,
                                                )}
                                            >
                                                {annotation.ref}
                                            </CitationPillUI>
                                        ),
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
