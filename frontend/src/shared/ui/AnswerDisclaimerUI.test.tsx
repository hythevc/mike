// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ANSWER_DISCLAIMER_TEXT, AnswerDisclaimerUI } from "./AnswerDisclaimerUI";

describe("AnswerDisclaimerUI (W25)", () => {
  it("renders the legal-information-not-legal-advice line", () => {
    render(<AnswerDisclaimerUI />);
    expect(screen.getByText(ANSWER_DISCLAIMER_TEXT)).toBeVisible();
  });

  it("carries the not-legal-advice wording and the check-citations ask", () => {
    expect(ANSWER_DISCLAIMER_TEXT).toContain(
      "Legal information, not legal advice",
    );
    expect(ANSWER_DISCLAIMER_TEXT).toContain(
      "Check each citation before relying on it",
    );
  });
});
