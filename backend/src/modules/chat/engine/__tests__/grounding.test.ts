// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { classifyGrounding, isNotInDocumentsAnswer } from "../grounding";

describe("classifyGrounding (W25)", () => {
  it("is not_found for the fixed sentence, tolerating case and whitespace", () => {
    expect(classifyGrounding("Not in these documents.", [])).toBe("not_found");
    expect(classifyGrounding("  not in these documents.  ", [])).toBe(
      "not_found",
    );
    expect(classifyGrounding("NOT IN THESE\n DOCUMENTS.", [])).toBe(
      "not_found",
    );
  });

  it("is cited when the answer has a document citation", () => {
    const citations = [{ kind: "document", ref: 1 }];
    expect(classifyGrounding("The term is 12 months.", citations)).toBe(
      "cited",
    );
  });

  it("is uncited when the answer cites no document", () => {
    expect(classifyGrounding("The term is 12 months.", [])).toBe("uncited");
    // A case citation is not a document citation for grounding purposes.
    expect(
      classifyGrounding("See the opinion.", [{ kind: "case", ref: 1 }]),
    ).toBe("uncited");
  });

  it("does not treat a near-miss of the sentence as not_found", () => {
    expect(
      classifyGrounding("Not in these documents, but generally...", []),
    ).toBe("uncited");
  });

  it("isNotInDocumentsAnswer matches only the fixed sentence", () => {
    expect(isNotInDocumentsAnswer("not in these documents.")).toBe(true);
    expect(isNotInDocumentsAnswer("not in these documents")).toBe(false);
  });
});
