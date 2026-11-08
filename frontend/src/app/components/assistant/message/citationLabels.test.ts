// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  isPageNotChecked,
  NOT_IN_DOCUMENTS_LABEL,
  otherPageLabel,
  PAGE_NOT_CHECKED_LABEL,
  QUOTE_NOT_FOUND_LABEL,
  UNCITED_ANSWER_LABEL,
} from "./citationLabels";

describe("citationLabels (W25)", () => {
  it("names the quote-not-found and page-not-checked states plainly", () => {
    expect(QUOTE_NOT_FOUND_LABEL).toBe("Quote not found - check source");
    expect(PAGE_NOT_CHECKED_LABEL).toBe("Page not checked");
    expect(NOT_IN_DOCUMENTS_LABEL).toBe("Not in these documents");
  });

  it("builds the other-page correction with the cited page", () => {
    expect(
      otherPageLabel({ verified: true, page_status: "other_page", found_page: 5, cited_page: 4 }),
    ).toBe("Quote is on p. 5, not p. 4");
  });

  it("drops the cited page when the model named none", () => {
    expect(
      otherPageLabel({ verified: true, page_status: "other_page", found_page: 3, cited_page: null }),
    ).toBe("Quote is on p. 3");
  });

  it("returns null for anything but an other-page quote", () => {
    expect(otherPageLabel(undefined)).toBeNull();
    expect(otherPageLabel({ verified: true, page_status: "cited_page", found_page: 2, cited_page: 2 })).toBeNull();
    expect(otherPageLabel({ verified: true, page_status: "not_checked" })).toBeNull();
  });

  it("detects the not-checked status", () => {
    expect(isPageNotChecked({ verified: true, page_status: "not_checked" })).toBe(true);
    expect(isPageNotChecked({ verified: true, page_status: "cited_page" })).toBe(false);
    expect(isPageNotChecked(undefined)).toBe(false);
  });

  it("uses no 'verified' or 'accurate' wording in any label", () => {
    // The labels describe what was checked, never a judgment of accuracy.
    for (const label of [
      QUOTE_NOT_FOUND_LABEL,
      PAGE_NOT_CHECKED_LABEL,
      NOT_IN_DOCUMENTS_LABEL,
      UNCITED_ANSWER_LABEL,
      otherPageLabel({
        verified: true,
        page_status: "other_page",
        found_page: 5,
        cited_page: 4,
      }) ?? "",
    ]) {
      expect(label.toLowerCase()).not.toContain("verified");
      expect(label.toLowerCase()).not.toContain("accurate");
    }
  });
});
