import type { CitationPageStatus } from "@mike/contracts";
import type { QuoteVerification } from "./types";
import {
  locateQuote,
  verifyQuoteAgainstSource,
} from "../../../lib/citations/quoteMatch";
import {
  pageForOffset,
  pageSpans,
  type PageSpan,
} from "../../../lib/citations/pageSpans";

// The quote matcher is shared with tabular cell checks, so it lives in the
// kernel. Re-exported so this module stays the chat engine's one entry point
// for citation verification.
export { locateQuote, verifyQuoteAgainstSource };

type DocQuoteEntry = { page?: number | string; quote: string };

// Mirrors the matcher: cross-page quotes join two page segments with this
// sentinel, and ellipses mark omissions. Used only to find where a multi-
// segment quote starts, so it can be mapped to a page.
const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";
const ELLIPSIS_PATTERN = /\.{3}|…/;

type CitedPage =
  | { kind: "none" }
  | { kind: "single"; page: number }
  | { kind: "range"; start: number; end: number };

/** Read the page the model cited: a number, an "N-M" range, or none. */
function parseCitedPage(page: unknown): CitedPage {
  if (typeof page === "number" && Number.isFinite(page)) {
    return { kind: "single", page: Math.floor(page) };
  }
  if (typeof page === "string") {
    const range = page.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      return { kind: "range", start: Number(range[1]), end: Number(range[2]) };
    }
    if (/^\s*\d+\s*$/.test(page)) {
      return { kind: "single", page: Number.parseInt(page, 10) };
    }
  }
  return { kind: "none" };
}

/**
 * Where the located quote begins in the source text. Single-segment quotes
 * carry `start_char`; cross-page and ellipsis quotes do not, so locate their
 * first verbatim fragment to find the page the match opens on.
 */
function matchStartOffset(
  source: string,
  quote: string,
  verification: QuoteVerification,
): number | null {
  if (typeof verification.start_char === "number") {
    return verification.start_char;
  }
  const firstSegment = quote.split(PAGE_BREAK_SENTINEL)[0] ?? quote;
  const fragment =
    firstSegment
      .split(ELLIPSIS_PATTERN)
      .map((part) => part.trim())
      .find((part) => /[\p{L}\p{N}]/u.test(part)) ?? firstSegment.trim();
  if (!fragment) return null;
  const location = locateQuote(source, fragment);
  return location ? location.start : null;
}

type PageClassification = {
  page_status?: CitationPageStatus;
  found_page?: number;
  cited_page?: number | null;
  /** The page value the citation should display (moved to the found page for
   *  an other-page match; kept otherwise). */
  targetPage: number | string | undefined;
};

/**
 * Decide whether a verified quote sits on the page it was cited to. With no
 * reliable `[Page N]` sequence the page is not checked; otherwise the quote's
 * start offset is mapped to a page and compared with the cited page or range.
 */
function classifyQuotePage(args: {
  entryPage: number | string | undefined;
  source: string;
  quote: string;
  verification: QuoteVerification;
  spans: PageSpan[] | null;
}): PageClassification {
  const { entryPage, source, quote, verification, spans } = args;
  if (!spans) {
    return { page_status: "not_checked", targetPage: entryPage };
  }
  if (!verification.verified) {
    // Found nowhere: no page verdict, as today.
    return { targetPage: entryPage };
  }
  const startChar = matchStartOffset(source, quote, verification);
  const foundPage = startChar === null ? null : pageForOffset(spans, startChar);
  if (foundPage === null) {
    return { targetPage: entryPage };
  }
  const cited = parseCitedPage(entryPage);
  if (cited.kind === "none") {
    return {
      page_status: "cited_page",
      found_page: foundPage,
      cited_page: null,
      targetPage: foundPage,
    };
  }
  if (cited.kind === "single") {
    const onCitedPage = cited.page === foundPage;
    return {
      page_status: onCitedPage ? "cited_page" : "other_page",
      found_page: foundPage,
      cited_page: cited.page,
      targetPage: onCitedPage ? cited.page : foundPage,
    };
  }
  const inRange = foundPage >= cited.start && foundPage <= cited.end;
  return {
    page_status: inRange ? "cited_page" : "other_page",
    found_page: foundPage,
    cited_page: cited.start,
    // Keep the range so the cross-page viewer still spans both pages.
    targetPage: inRange ? entryPage : foundPage,
  };
}

export type CaseOpinionSource = {
  opinion_id: number | null;
  text: string;
};

type CaseQuoteEntry = {
  opinionId?: number | null;
  opinion_id?: number | null;
  quote: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withVerifiedDocumentQuotes(
  documentValue: unknown,
  verifiedQuotes: {
    quote: string;
    verification: QuoteVerification;
    page?: number | string;
  }[],
): Record<string, unknown> | undefined {
  const document = record(documentValue);
  if (!document) return undefined;
  const documentQuotes = Array.isArray(document.quotes) ? document.quotes : [];
  return {
    ...document,
    quotes: documentQuotes.map((value, index) => {
      const quote = record(value);
      const verifiedQuote = verifiedQuotes[index];
      if (!quote || !verifiedQuote) return value;
      const target = record(quote.target);
      // A page-checked document citation may move its target to the page the
      // quote was actually found on, so the viewer opens the right page. Case
      // quotes carry no page and are left untouched.
      const movedTarget =
        verifiedQuote.page !== undefined && target
          ? { target: { ...target, page: verifiedQuote.page } }
          : {};
      return {
        ...quote,
        quote: verifiedQuote.quote,
        verification: verifiedQuote.verification,
        ...movedTarget,
      };
    }),
  };
}

function caseQuoteOpinionId(quote: CaseQuoteEntry): number | null {
  const value = quote.opinionId ?? quote.opinion_id;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : null;
}

/**
 * Match each case citation quote against the opinion text cached during the
 * CourtListener read. Quotes with an opinion ID are checked only against that
 * opinion; quotes without one are checked against the complete case text.
 */
export async function verifyCaseCitationAnnotation(
  annotation: unknown,
  getCaseOpinions: (clusterId: number) => Promise<CaseOpinionSource[]>,
): Promise<unknown> {
  const a = record(annotation);
  if (!a || a.kind !== "case") return annotation;
  const clusterId =
    typeof a.cluster_id === "number" && Number.isFinite(a.cluster_id)
      ? Math.floor(a.cluster_id)
      : null;
  if (clusterId === null) return annotation;

  const entries = Array.isArray(a.quotes)
    ? a.quotes
        .map((value) => record(value))
        .filter(
          (value): value is Record<string, unknown> & CaseQuoteEntry =>
            !!value && typeof value.quote === "string" && !!value.quote,
        )
    : [];
  if (!entries.length) return annotation;

  let opinions: CaseOpinionSource[];
  try {
    opinions = await getCaseOpinions(clusterId);
  } catch {
    opinions = [];
  }

  const completeCaseText = opinions.map((opinion) => opinion.text).join("\n");
  const verifiedQuotes = entries.map((entry) => {
    const opinionId = caseQuoteOpinionId(entry);
    const source =
      opinionId === null
        ? completeCaseText
        : (opinions.find((opinion) => opinion.opinion_id === opinionId)?.text ??
          "");
    const result = verifyQuoteAgainstSource(source, entry.quote);
    const { needs_correction, ...verification } = result;
    const quote =
      needs_correction && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    return { ...entry, quote, verification };
  });

  const verifiedDocument = withVerifiedDocumentQuotes(
    a.document,
    verifiedQuotes,
  );

  return {
    ...a,
    quotes: verifiedQuotes,
    verified: verifiedQuotes.every((quote) => quote.verification.verified),
    ...(verifiedDocument ? { document: verifiedDocument } : {}),
  };
}

/**
 * Attach server-side verification to one document citation annotation.
 * Case-law annotations are handled separately by
 * `verifyCaseCitationAnnotation`. For document annotations, source text is
 * fetched once via `getSourceText(doc_id)` and each quote is located in it;
 * corrected quotes have the exact source excerpt swapped in so the UI never
 * shows drifted text.
 */
export async function verifyDocumentCitationAnnotation(
  annotation: unknown,
  getSourceText: (docId: string) => Promise<string>,
): Promise<unknown> {
  if (!annotation || typeof annotation !== "object") return annotation;
  const a = annotation as Record<string, unknown>;
  if (a.kind === "case") return annotation;
  const docId = typeof a.doc_id === "string" ? a.doc_id : null;
  if (!docId) return annotation;

  const entries: DocQuoteEntry[] = Array.isArray(a.quotes)
    ? (a.quotes as DocQuoteEntry[])
    : typeof a.quote === "string"
      ? [{ page: a.page as number | string | undefined, quote: a.quote }]
      : [];
  if (!entries.length) return annotation;

  let source: string;
  try {
    source = await getSourceText(docId);
  } catch {
    source = "";
  }

  // Page boundaries for this document, when the extracted text has a reliable
  // [Page N] sequence. Null for DOCX, inline text, spreadsheets and slides.
  const spans = pageSpans(source);

  const verifiedQuotes = entries.map((entry) => {
    const result = verifyQuoteAgainstSource(source, entry.quote);
    const { needs_correction, ...verification } = result;
    // Swap the exact source text into the displayed quote when it drifted,
    // so a drifted quote is never surfaced as the source's words.
    const quote =
      needs_correction && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    const page = classifyQuotePage({
      entryPage: entry.page,
      source,
      quote: entry.quote,
      verification,
      spans,
    });
    if (page.page_status) verification.page_status = page.page_status;
    if (page.found_page !== undefined) verification.found_page = page.found_page;
    if (page.cited_page !== undefined) verification.cited_page = page.cited_page;
    return { ...entry, quote, verification, page: page.targetPage };
  });

  const verified = verifiedQuotes.every((q) => q.verification.verified);

  const verifiedDocument = withVerifiedDocumentQuotes(
    a.document,
    verifiedQuotes,
  );

  return {
    ...a,
    page: verifiedQuotes[0]?.page ?? a.page,
    quote: verifiedQuotes[0]?.quote ?? a.quote,
    quotes: verifiedQuotes,
    verified,
    ...(verifiedDocument ? { document: verifiedDocument } : {}),
  };
}

/**
 * Verify a batch of citation annotations. Document annotations are verified
 * against extracted file text and case annotations against opinion text read
 * during this turn. Callers must provide both source resolvers so a citation
 * kind can never silently bypass verification.
 */
export async function verifyCitations(
  annotations: unknown[],
  getSourceText: (docId: string) => Promise<string>,
  getCaseOpinions: (clusterId: number) => Promise<CaseOpinionSource[]>,
): Promise<unknown[]> {
  return Promise.all(
    annotations.map((annotation) => {
      const value = record(annotation);
      return value?.kind === "case"
        ? verifyCaseCitationAnnotation(annotation, getCaseOpinions)
        : verifyDocumentCitationAnnotation(annotation, getSourceText);
    }),
  );
}
