import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Citation, DocumentCitation } from "../../shared/types";
import {
  buildCitationAppendix,
  citationTooltip,
  CitationsBlock,
} from "./CitationSources";
import { ANSWER_DISCLAIMER_TEXT } from "@/shared/ui/AnswerDisclaimerUI";

function documentCitation(ref: number, verified?: boolean): DocumentCitation {
  return {
    type: "citation_data",
    kind: "document",
    ref,
    doc_id: `doc-${ref}`,
    document_id: `document-${ref}`,
    filename: `source-${ref}.pdf`,
    page: ref,
    quote: `Quote ${ref}`,
    quotes: [{ page: ref, quote: `Quote ${ref}` }],
    ...(verified === undefined ? {} : { verified }),
  };
}

describe("CitationsBlock verification states", () => {
  it("marks unverified document citation buttons with the error colors", () => {
    render(
      <CitationsBlock
        citations={[documentCitation(1, false), documentCitation(2)]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Citation 1. Quote not found - check source",
      }),
    ).toHaveClass(
      "!bg-red-100/85",
      "!text-red-800",
      "dark:!bg-red-950",
      "dark:!text-white",
    );
    const verifiedButton = screen.getByRole("button", {
      name: "Citation 2",
    });
    expect(verifiedButton).toHaveClass("bg-gray-200/80", "text-gray-800");
  });

  it("includes only unverified warnings in citation tooltips", () => {
    expect(citationTooltip(documentCitation(3, false))).toContain(
      "Quote could not be matched to the source text.",
    );
    expect(citationTooltip(documentCitation(3, true))).not.toContain("matched");
  });

  it("leaves case citations outside document verification styling", () => {
    const citation: Citation = {
      type: "citation_data",
      kind: "case",
      ref: 4,
      cluster_id: 99,
      case_name: "Example v Example",
      quotes: [],
    };
    render(<CitationsBlock citations={[citation]} />);

    const button = screen.getByRole("button", { name: "Citation 4" });
    expect(button).toHaveClass("bg-gray-200/80", "text-gray-800");
  });

  it("notes an other-page and a not-checked quote in the tooltip (W25)", () => {
    const otherPage: DocumentCitation = {
      ...documentCitation(5),
      quotes: [
        {
          page: 5,
          quote: "Quote 5",
          verification: {
            verified: true,
            page_status: "other_page",
            found_page: 5,
            cited_page: 4,
          },
        },
      ],
    };
    expect(citationTooltip(otherPage)).toContain("Quote is on p. 5, not p. 4");

    const notChecked: DocumentCitation = {
      ...documentCitation(6),
      filename: "memo.docx",
      quotes: [
        {
          page: 1,
          quote: "Quote 6",
          verification: { verified: true, page_status: "not_checked" },
        },
      ],
    };
    expect(citationTooltip(notChecked)).toContain("Page not checked");
  });

  it("adds the selected quote background only to the active citation", () => {
    const inactive = documentCitation(1);
    const active = documentCitation(2);

    render(
      <CitationsBlock
        citations={[inactive, active]}
        activeCitation={active}
      />,
    );

    expect(screen.getByRole("button", { name: "Citation 2" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Citation 2" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Citation 1" }),
    ).not.toHaveAttribute("data-active");
  });
});

describe("buildCitationAppendix (W25)", () => {
  it("carries each citation's page and ends with the disclaimer", () => {
    const { text, html } = buildCitationAppendix([
      documentCitation(1),
      documentCitation(2),
    ]);
    expect(text).toContain("Page 1");
    expect(text).toContain("Page 2");
    expect(text.trimEnd().endsWith(ANSWER_DISCLAIMER_TEXT)).toBe(true);
    expect(html).toContain(ANSWER_DISCLAIMER_TEXT);
  });

  it("carries a spreadsheet citation's Sheet!Cell locator", () => {
    const spreadsheet: DocumentCitation = {
      type: "citation_data",
      kind: "document",
      ref: 1,
      doc_id: "doc-1",
      document_id: "document-1",
      filename: "data.xlsx",
      page: 1,
      quote: "42",
      sheet: "Sheet1",
      cell: "B7",
      quotes: [{ page: 1, quote: "42", sheet: "Sheet1", cell: "B7" }],
    };
    const { text } = buildCitationAppendix([spreadsheet]);
    expect(text).toContain("Sheet1!B7");
  });

  it("still ends with the disclaimer when there are no citations", () => {
    const { text, html } = buildCitationAppendix([]);
    expect(text.trim()).toBe(ANSWER_DISCLAIMER_TEXT);
    expect(html).toContain(ANSWER_DISCLAIMER_TEXT);
  });
});
