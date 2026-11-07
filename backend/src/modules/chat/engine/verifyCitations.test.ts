import { describe, it, expect, vi } from "vitest";

// verifyCitations only reuses the pure normalizeWithMap matcher from
// documentOps, but importing documentOps pulls in its storage/supabase graph.
// Keep those module side-effects offline — this test injects source text
// directly and never touches storage, proving verification adds no egress
// (air-gap safe).
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/storage", () => ({ downloadFile: vi.fn() }));

import {
  locateQuote,
  verifyQuoteAgainstSource,
  verifyCaseCitationAnnotation,
  verifyDocumentCitationAnnotation,
  verifyCitations,
} from "./verifyCitations";

// Deterministic in-memory source text — no storage/model/network. Proves
// verification only reads bytes handed to it (air-gap safe).
const SOURCE = [
  "## Page 1",
  "The Tenant shall pay rent on the first day of each month.",
  "The Landlord may terminate this Lease upon written notice.",
].join("\n");

function fetcherFor(map: Record<string, string>) {
  return async (docId: string) => map[docId] ?? "";
}

function docAnnotation(quotes: { page: number | string; quote: string }[]) {
  return {
    type: "citation_data",
    kind: "document" as const,
    ref: 1,
    doc_id: "doc-1",
    document_id: "uuid-1",
    filename: "lease.pdf",
    page: quotes[0]?.page ?? 1,
    quote: quotes[0]?.quote ?? "",
    quotes,
  };
}

describe("locateQuote", () => {
  it("returns exact offsets for an exact substring match", () => {
    const quote = "pay rent on the first day";
    const loc = locateQuote(SOURCE, quote);
    expect(loc).not.toBeNull();
    expect(SOURCE.slice(loc!.start, loc!.end)).toBe(quote);
    expect(loc!.excerpt).toBe(quote);
  });

  it("returns null when the quote is absent", () => {
    expect(
      locateQuote(SOURCE, "the Tenant shall vacate immediately"),
    ).toBeNull();
  });
});

describe("verifyQuoteAgainstSource", () => {
  it("exact match → verified with correct offsets into the source", () => {
    const quote = "The Landlord may terminate this Lease";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.verified).toBe(true);
    expect(v.needs_correction).toBe(false);
    expect(v.source_excerpt).toBe(quote);
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(quote);
  });

  it("whitespace + case drift → verified with the exact source excerpt", () => {
    const drifted = "the  landlord   MAY terminate this lease";
    const v = verifyQuoteAgainstSource(SOURCE, drifted);
    expect(v.verified).toBe(true);
    expect(v.needs_correction).toBe(true);
    expect(v.source_excerpt).toBe("The Landlord may terminate this Lease");
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(v.source_excerpt);
  });

  it("punctuation drift → verified with corrected excerpt and offsets", () => {
    // Model inserted a stray comma the source does not contain.
    const drifted = "pay rent, on the first day";
    const v = verifyQuoteAgainstSource(SOURCE, drifted);
    expect(v.verified).toBe(true);
    expect(v.needs_correction).toBe(true);
    expect(v.source_excerpt).toBe("pay rent on the first day");
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(v.source_excerpt);
  });

  it("fabricated quote → unverified with no offsets", () => {
    const v = verifyQuoteAgainstSource(SOURCE, "The Tenant waives all rights.");
    expect(v.verified).toBe(false);
    expect(v.start_char).toBeUndefined();
    expect(v.end_char).toBeUndefined();
    expect(v.source_excerpt).toBeUndefined();
  });

  it("empty / unreadable source → unverified", () => {
    expect(verifyQuoteAgainstSource("", "anything").verified).toBe(false);
    expect(
      verifyQuoteAgainstSource("Document could not be read.", "anything")
        .verified,
    ).toBe(false);
  });

  it("cross-page [[PAGE_BREAK]] quote → each segment verified independently", () => {
    const src = "the first day of each month. The Landlord may terminate";
    const quote =
      "the first day of each month[[PAGE_BREAK]]The Landlord may terminate";
    const v = verifyQuoteAgainstSource(src, quote);
    expect(v.verified).toBe(true);
    expect(v.source_excerpt).toContain("[[PAGE_BREAK]]");
  });

  it("cross-page quote with a missing segment → unverified", () => {
    const quote = "the first day of each month[[PAGE_BREAK]]never appears here";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.verified).toBe(false);
  });

  it("rejects cross-page segments in reverse document order", () => {
    const source = "Page one ending. Page two beginning.";
    const quote = "Page two beginning[[PAGE_BREAK]]Page one ending";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(false);
  });

  it("uses a later occurrence when repeated text satisfies the order", () => {
    const source = "Repeated text. Page one ending. Repeated text.";
    const quote = "Page one ending[[PAGE_BREAK]]Repeated text";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(true);
  });

  it("considers normalized and exact occurrences in source order", () => {
    const source = "PAGE ONE ENDING. Page two beginning. Page one ending.";
    const quote = "Page one ending[[PAGE_BREAK]]Page two beginning";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(true);
  });

  it("backtracks to a later occurrence that satisfies the gap bound", () => {
    const source = `Repeated text.${"x".repeat(50_000)}Repeated text. Page two beginning.`;
    const quote = "Repeated text[[PAGE_BREAK]]Page two beginning";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(true);
  });

  it("rejects cross-page segments separated by an unreasonable distance", () => {
    const source = `Page one ending.${"x".repeat(50_000)}Page two beginning.`;
    const quote = "Page one ending[[PAGE_BREAK]]Page two beginning";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(false);
  });

  it("orders the next page after the full preceding ellipsis span", () => {
    const source = "Opening text. Next page text. Closing text.";
    const quote = "Opening text...Closing text[[PAGE_BREAK]]Next page text";
    const v = verifyQuoteAgainstSource(source, quote);
    expect(v.verified).toBe(false);
  });

  it.each(["...", "…"])(
    "ellipsis-separated quote using %s verifies each excerpt independently",
    (ellipsis) => {
      const quote = `The Tenant shall pay rent${ellipsis}The Landlord may terminate this Lease`;
      const v = verifyQuoteAgainstSource(SOURCE, quote);
      expect(v.verified).toBe(true);
      expect(v.source_excerpt).toBe(
        "The Tenant shall pay rent ... The Landlord may terminate this Lease",
      );
    },
  );

  it("ellipsis-separated quote with a missing excerpt → unverified", () => {
    const quote =
      "The Tenant shall pay rent...the Tenant may sublet without consent";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.verified).toBe(false);
  });

  it("supports ellipsis omissions inside a cross-page quote", () => {
    const quote =
      "The Tenant shall pay...first day of each month[[PAGE_BREAK]]The Landlord may terminate...written notice";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.verified).toBe(true);
    expect(v.source_excerpt).toContain("[[PAGE_BREAK]]");
  });
});

describe("verifyDocumentCitationAnnotation", () => {
  const fetcher = fetcherFor({ "doc-1": SOURCE });

  it("marks a verified quote and attaches per-quote offsets", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verified).toBe(true);
    const quotes = ann.quotes as { verification: { verified: boolean } }[];
    expect(quotes[0].verification.verified).toBe(true);
  });

  it("corrects a drifted quote by swapping in the exact source excerpt", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "the  TENANT shall pay rent" }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verified).toBe(true);
    const quotes = ann.quotes as {
      quote: string;
      verification: { verified: boolean; source_excerpt: string };
    }[];
    expect(quotes[0].verification.verified).toBe(true);
    expect(quotes[0].verification).not.toHaveProperty("needs_correction");
    // The displayed quote is swapped to the true source text.
    expect(quotes[0].quote).toBe("The Tenant shall pay rent");
    // Legacy top-level quote mirror is updated too.
    expect(ann.quote).toBe("The Tenant shall pay rent");
  });

  it("marks a fabricated quote unverified and preserves the model text", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant may sublet freely." }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verified).toBe(false);
    const quotes = ann.quotes as { quote: string }[];
    expect(quotes[0].quote).toBe("The Tenant may sublet freely.");
  });

  it("aggregates to unverified when any quote is unverified", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([
        { page: 1, quote: "The Tenant shall pay rent" },
        { page: 1, quote: "Nonexistent clause here." },
      ]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verified).toBe(false);
  });

  it("updates verification and corrected text on normalized document quotes", async () => {
    const annotation = {
      ...docAnnotation([
        { page: 1, quote: "the TENANT shall pay rent" },
        { page: 2, quote: "Nonexistent clause here." },
      ]),
      document: {
        document_id: "doc-1",
        title: "lease.docx",
        type: "docx",
        metadata: [],
        quotes: [
          { quote: "the TENANT shall pay rent", target: { page: 1 } },
          { quote: "Nonexistent clause here.", target: { page: 2 } },
        ],
      },
    };

    const verified = (await verifyDocumentCitationAnnotation(
      annotation,
      fetcher,
    )) as Record<string, unknown>;
    const document = verified.document as {
      quotes: { quote: string; verification: { verified: boolean } }[];
    };

    expect(document.quotes).toMatchObject([
      {
        quote: "The Tenant shall pay rent",
        verification: { verified: true },
      },
      {
        quote: "Nonexistent clause here.",
        verification: { verified: false },
      },
    ]);
  });

  it("unreadable source → all quotes unverified", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
      fetcherFor({ "doc-1": "Document could not be read." }),
    )) as Record<string, unknown>;
    expect(ann.verified).toBe(false);
  });

  it("leaves case-law annotations untouched (no CourtListener regression)", async () => {
    const caseAnn = {
      type: "citation_data",
      kind: "case",
      ref: 2,
      cluster_id: 42,
      case_name: "Roe v. Doe",
      quotes: [
        { opinionId: null, type: null, author: null, quote: "held that…" },
      ],
    };
    const out = await verifyDocumentCitationAnnotation(caseAnn, fetcher);
    expect(out).toBe(caseAnn);
    expect(out as Record<string, unknown>).not.toHaveProperty("verified");
  });
});

describe("verifyDocumentCitationAnnotation page checks (W25)", () => {
  // PDF-style source with reliable [Page N] markers.
  const PDF_SOURCE = [
    "[Page 1]",
    "The Tenant shall pay rent on the first day of each month.",
    "",
    "[Page 2]",
    "The Landlord may terminate this Lease upon written notice.",
    "",
    "[Page 3]",
    "Governing law is the State of Delaware.",
  ].join("\n");
  const pdfFetcher = fetcherFor({ "doc-1": PDF_SOURCE });

  function pdfAnnotation(quotes: { page?: number | string; quote: string }[]) {
    return {
      type: "citation_data",
      kind: "document" as const,
      ref: 1,
      doc_id: "doc-1",
      document_id: "uuid-1",
      filename: "lease.pdf",
      quotes,
    };
  }

  async function firstQuote(annotation: unknown) {
    const ann = (await verifyDocumentCitationAnnotation(
      annotation,
      pdfFetcher,
    )) as {
      page?: number | string;
      quotes: {
        page?: number | string;
        verification: {
          verified: boolean;
          page_status?: string;
          found_page?: number;
          cited_page?: number | null;
        };
      }[];
    };
    return ann;
  }

  it("a quote on its cited page is cited_page", async () => {
    const ann = await firstQuote(
      pdfAnnotation([
        { page: 2, quote: "The Landlord may terminate this Lease" },
      ]),
    );
    expect(ann.quotes[0].verification).toMatchObject({
      verified: true,
      page_status: "cited_page",
      found_page: 2,
      cited_page: 2,
    });
    expect(ann.quotes[0].page).toBe(2);
  });

  it("the same quote cited to the wrong page is other_page, moves the target, keeps the cited page", async () => {
    const ann = await firstQuote(
      pdfAnnotation([
        { page: 1, quote: "The Landlord may terminate this Lease" },
      ]),
    );
    expect(ann.quotes[0].verification).toMatchObject({
      verified: true,
      page_status: "other_page",
      found_page: 2,
      cited_page: 1,
    });
    // Target page moved to the page the quote was found on.
    expect(ann.quotes[0].page).toBe(2);
    expect(ann.page).toBe(2);
  });

  it("moves the document-quote target page too, so the viewer opens the right page", async () => {
    const annotation = {
      ...pdfAnnotation([
        { page: 1, quote: "The Landlord may terminate this Lease" },
      ]),
      document: {
        document_id: "doc-1",
        title: "lease.pdf",
        type: "pdf",
        metadata: [],
        quotes: [
          {
            quote: "The Landlord may terminate this Lease",
            target: { page: 1 },
          },
        ],
      },
    };
    const verified = (await verifyDocumentCitationAnnotation(
      annotation,
      pdfFetcher,
    )) as { document: { quotes: { target: { page: number } }[] } };
    expect(verified.document.quotes[0].target.page).toBe(2);
  });

  it("a PDF quote that names no page gets cited_page null", async () => {
    const ann = await firstQuote(
      pdfAnnotation([{ quote: "Governing law is the State of Delaware" }]),
    );
    expect(ann.quotes[0].verification.verified).toBe(true);
    expect(ann.quotes[0].verification.cited_page).toBeNull();
    expect(ann.quotes[0].verification.found_page).toBe(3);
    // No forced page 1: the target is the page the quote was found on.
    expect(ann.quotes[0].page).toBe(3);
  });

  it("an 'N-M' quote across those pages is cited_page", async () => {
    const ann = await firstQuote(
      pdfAnnotation([
        {
          page: "1-2",
          quote:
            "pay rent on the first day of each month[[PAGE_BREAK]]The Landlord may terminate this Lease",
        },
      ]),
    );
    expect(ann.quotes[0].verification).toMatchObject({
      verified: true,
      page_status: "cited_page",
      found_page: 1,
    });
    // The range is kept so the cross-page viewer still spans both pages.
    expect(ann.quotes[0].page).toBe("1-2");
  });

  it("DOCX and spreadsheet quotes are not_checked", async () => {
    // SOURCE uses '## Page 1' (DOCX-style), which carries no [Page N] markers.
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
      fetcherFor({ "doc-1": SOURCE }),
    )) as { quotes: { verification: { page_status?: string } }[] };
    expect(ann.quotes[0].verification.page_status).toBe("not_checked");
    expect(ann.quotes[0].verification).not.toHaveProperty("found_page");
  });

  it("an inline-text quote with no markers is not_checked", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      pdfAnnotation([{ page: 1, quote: "Confidential Information" }]),
      fetcherFor({ "doc-1": "This Agreement protects Confidential Information." }),
    )) as { quotes: { verification: { page_status?: string } }[] };
    expect(ann.quotes[0].verification.page_status).toBe("not_checked");
  });

  it("a fabricated quote stays verified false with no page verdict", async () => {
    const ann = await firstQuote(
      pdfAnnotation([{ page: 2, quote: "The Tenant waives every right." }]),
    );
    expect(ann.quotes[0].verification.verified).toBe(false);
    expect(ann.quotes[0].verification).not.toHaveProperty("page_status");
  });
});

describe("verifyCaseCitationAnnotation", () => {
  const opinions = async () => [
    {
      opinion_id: 11,
      text: "The Court holds that the statutory requirement applies.",
    },
    {
      opinion_id: 12,
      text: "The dissent would reverse the judgment.",
    },
  ];

  it("verifies against the targeted opinion and updates the normalized document", async () => {
    const annotation = {
      type: "citation_data",
      kind: "case",
      ref: 2,
      cluster_id: 42,
      quotes: [
        {
          opinionId: 11,
          type: "lead",
          author: null,
          quote: "the COURT holds that the statutory requirement applies",
        },
      ],
      document: {
        document_id: "case:42",
        title: "Example v Example",
        type: "case",
        metadata: [],
        quotes: [
          {
            quote: "the COURT holds that the statutory requirement applies",
            target: { subdocument_id: "case:42:opinion:11" },
          },
        ],
      },
    };

    const verified = (await verifyCaseCitationAnnotation(
      annotation,
      opinions,
    )) as Record<string, unknown>;
    expect(verified.verified).toBe(true);
    const quotes = verified.quotes as {
      quote: string;
      verification: { verified: boolean };
    }[];
    expect(quotes[0].quote).toBe(
      "The Court holds that the statutory requirement applies",
    );
    expect(quotes[0].verification.verified).toBe(true);
    const document = verified.document as {
      quotes: { quote: string; verification: { verified: boolean } }[];
    };
    expect(document.quotes[0]).toMatchObject({
      quote: "The Court holds that the statutory requirement applies",
      verification: { verified: true },
    });
  });

  it("does not match a quote against a different opinion", async () => {
    const verified = (await verifyCaseCitationAnnotation(
      {
        type: "citation_data",
        kind: "case",
        ref: 2,
        cluster_id: 42,
        quotes: [
          {
            opinionId: 12,
            quote: "The Court holds that the statutory requirement applies.",
          },
        ],
      },
      opinions,
    )) as Record<string, unknown>;
    expect(verified.verified).toBe(false);
  });
});

describe("verifyCitations (batch)", () => {
  it("verifies documents and passes case citations through unchanged", async () => {
    const caseAnn = {
      type: "citation_data",
      kind: "case",
      ref: 2,
      cluster_id: 7,
    };
    const out = await verifyCitations(
      [
        docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
        caseAnn,
      ],
      fetcherFor({ "doc-1": SOURCE }),
      async () => [],
    );
    expect((out[0] as Record<string, unknown>).verified).toBe(true);
    expect(out[1]).toBe(caseAnn);
  });

  it("verifies case citations when opinion text is available", async () => {
    const out = await verifyCitations(
      [
        {
          type: "citation_data",
          kind: "case",
          ref: 2,
          cluster_id: 7,
          quotes: [{ opinionId: 3, quote: "Binding case text" }],
        },
      ],
      fetcherFor({}),
      async () => [{ opinion_id: 3, text: "Binding case text" }],
    );
    expect(out[0]).toMatchObject({ verified: true });
  });
});
