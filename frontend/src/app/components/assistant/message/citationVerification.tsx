import { CircleAlert } from "lucide-react";
import type { Citation, DocumentCitationQuote } from "../../shared/types";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/popover";
import {
  isPageNotChecked,
  otherPageLabel,
  PAGE_NOT_CHECKED_LABEL,
  QUOTE_NOT_FOUND_LABEL,
} from "./citationLabels";

export type CitationVerificationDisplayState = "verified" | "unverified";

type VerificationPresentation = {
  label: string;
  description: string;
  pillClassName: string;
};

const UNVERIFIED_PRESENTATION: VerificationPresentation = {
  label: QUOTE_NOT_FOUND_LABEL,
  description: "Quote could not be matched to the source text.",
  pillClassName:
    "!bg-red-100/85 !text-red-800 hover:!bg-red-200/80 hover:!text-red-800 dark:!bg-red-950 dark:!text-white dark:hover:!bg-red-900 dark:hover:!text-white",
};

/**
 * A plain-text note about where a cited quote actually sits, for a citation's
 * tooltip: an other-page correction, or that the page could not be checked.
 * Returns null when nothing needs saying.
 */
export function citationPageStatusNote(citation: Citation): string | null {
  if (citation.kind === "case") return null;
  const quotes = citation.quotes ?? [];
  for (const quote of quotes) {
    const other = otherPageLabel(quote.verification);
    if (other) return other;
  }
  return quotes.some((quote) => isPageNotChecked(quote.verification))
    ? PAGE_NOT_CHECKED_LABEL
    : null;
}

/** The other-page correction for a single quote, or null. */
export function quoteOtherPageLabel(
  quote: Pick<DocumentCitationQuote, "verification">,
): string | null {
  return otherPageLabel(quote.verification);
}

export function citationVerificationState(
  citation: Citation,
): CitationVerificationDisplayState {
  return citation.verified === false ? "unverified" : "verified";
}

export function quoteVerificationState(
  quote: Pick<DocumentCitationQuote, "verification">,
): CitationVerificationDisplayState {
  return quote.verification?.verified === false ? "unverified" : "verified";
}

export function citationVerificationPillClassName(citation: Citation): string {
  return citationVerificationState(citation) === "unverified"
    ? UNVERIFIED_PRESENTATION.pillClassName
    : "";
}

export function citationVerificationDescription(
  citation: Citation,
): string | null {
  const state = citationVerificationState(citation);
  return state === "unverified" ? UNVERIFIED_PRESENTATION.description : null;
}

export function citationVerificationAriaLabel(citation: Citation): string {
  const state = citationVerificationState(citation);
  const suffix =
    state === "unverified" ? `. ${UNVERIFIED_PRESENTATION.label}` : "";
  return `Citation ${citation.ref}${suffix}`;
}

export function CitationVerificationBadge({
  state,
}: {
  state: CitationVerificationDisplayState;
}) {
  if (state !== "unverified") return null;

  const presentation = UNVERIFIED_PRESENTATION;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PillButtonUI
          tone="white"
          size="xs"
          className="w-fit gap-1 font-sans !text-red-600 hover:!text-red-700"
        >
          <CircleAlert className="h-3 w-3" aria-hidden="true" />
          {presentation.label}
        </PillButtonUI>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[220] w-72"
      >
        <span className="block text-xs font-medium text-gray-900">
          Quote not found in document
        </span>
        <span className="mt-1 block text-xs font-normal leading-5 text-gray-600">
          The language model produced a quote that could not be found in the
          source document. Treat it as hallucinated and double-check the
          related section of the assistant response against the document
          before relying on it.
        </span>
      </PopoverContent>
    </Popover>
  );
}
