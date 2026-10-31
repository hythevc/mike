import type { QuoteVerification } from "./types";
import {
  locateQuote,
  verifyQuoteAgainstSource,
} from "../../../lib/citations/quoteMatch";

// The quote matcher is shared with tabular cell checks, so it lives in the
// kernel. Re-exported so this module stays the chat engine's one entry point
// for citation verification.
export { locateQuote, verifyQuoteAgainstSource };

type DocQuoteEntry = { page: number | string; quote: string };

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
  verifiedQuotes: { quote: string; verification: QuoteVerification }[],
): Record<string, unknown> | undefined {
  const document = record(documentValue);
  if (!document) return undefined;
  const documentQuotes = Array.isArray(document.quotes) ? document.quotes : [];
  return {
    ...document,
    quotes: documentQuotes.map((value, index) => {
      const quote = record(value);
      const verifiedQuote = verifiedQuotes[index];
      return quote && verifiedQuote
        ? {
            ...quote,
            quote: verifiedQuote.quote,
            verification: verifiedQuote.verification,
          }
        : value;
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
      ? [{ page: (a.page as number | string) ?? 1, quote: a.quote }]
      : [];
  if (!entries.length) return annotation;

  let source: string;
  try {
    source = await getSourceText(docId);
  } catch {
    source = "";
  }

  const verifiedQuotes = entries.map((entry) => {
    const result = verifyQuoteAgainstSource(source, entry.quote);
    const { needs_correction, ...verification } = result;
    // Swap the exact source text into the displayed quote when it drifted,
    // so a drifted quote is never surfaced as the source's words.
    const quote =
      needs_correction && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    return { ...entry, quote, verification };
  });

  const verified = verifiedQuotes.every((q) => q.verification.verified);

  const verifiedDocument = withVerifiedDocumentQuotes(
    a.document,
    verifiedQuotes,
  );

  return {
    ...a,
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
