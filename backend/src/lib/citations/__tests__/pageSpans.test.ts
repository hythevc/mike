// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "vitest";
import { pageForOffset, pageSpans } from "../pageSpans";

// Mirror lib/pdfText.ts: each page is "[Page N]\n<layout>", pages joined with
// a blank line.
function pdf(pages: string[]): string {
  return pages.map((text, i) => `[Page ${i + 1}]\n${text}`).join("\n\n");
}

describe("pageSpans", () => {
  it("line-anchored markers 1..N give N spans covering the whole text", () => {
    const source = pdf(["First page body.", "Second page body.", "Third."]);
    const spans = pageSpans(source);
    expect(spans).not.toBeNull();
    expect(spans).toHaveLength(3);
    // Spans are contiguous and cover the whole string.
    expect(spans![0].start).toBe(0);
    expect(spans![2].end).toBe(source.length);
    for (let i = 0; i + 1 < spans!.length; i += 1) {
      expect(spans![i].end).toBe(spans![i + 1].start);
    }
    // The located text maps back to the right page.
    const second = source.indexOf("Second page body.");
    expect(pageForOffset(spans!, second)).toBe(2);
    const third = source.indexOf("Third.");
    expect(pageForOffset(spans!, third)).toBe(3);
    const first = source.indexOf("First page body.");
    expect(pageForOffset(spans!, first)).toBe(1);
  });

  it("a single page gives one span", () => {
    const spans = pageSpans(pdf(["Only body."]));
    expect(spans).toHaveLength(1);
    expect(spans![0]).toEqual({ start: 0, end: pdf(["Only body."]).length });
  });

  it("a repeated marker gives null", () => {
    const source = [
      "[Page 1]",
      "a",
      "",
      "[Page 2]",
      "b",
      "",
      "[Page 2]",
      "c",
    ].join("\n");
    expect(pageSpans(source)).toBeNull();
  });

  it("a missing marker gives null", () => {
    const source = ["[Page 1]", "a", "", "[Page 3]", "c"].join("\n");
    expect(pageSpans(source)).toBeNull();
  });

  it("an out-of-order marker gives null", () => {
    const source = ["[Page 2]", "b", "", "[Page 1]", "a"].join("\n");
    expect(pageSpans(source)).toBeNull();
  });

  it("a document line that itself reads '[Page 2]' fails closed", () => {
    // A two-page document whose page-two body quotes a '[Page 2]' line. The
    // stray marker makes the sequence 1, 2, 2 — repeated — so null.
    const source = [
      "[Page 1]",
      "The agreement spans two pages.",
      "",
      "[Page 2]",
      "As shown on",
      "[Page 2]",
      "the schedule applies.",
    ].join("\n");
    expect(pageSpans(source)).toBeNull();
  });

  it("'[Page N form fields]' is not a marker", () => {
    const source = [
      "[Page 1]",
      "body with a positioned field",
      "[Page 1 form fields]",
      "Name: Jane",
      "",
      "[Page 2]",
      "second page",
    ].join("\n");
    const spans = pageSpans(source);
    expect(spans).toHaveLength(2);
    // The form-fields line stays inside page 1's span.
    const fieldLine = source.indexOf("[Page 1 form fields]");
    expect(pageForOffset(spans!, fieldLine)).toBe(1);
  });

  it("a no-text-layer notice is not a marker", () => {
    const notice =
      "[Page 2 of this PDF has no text layer, so its content cannot be read. It is most likely scanned and needs OCR.]";
    const source = ["[Page 1]", "readable body", "", notice].join("\n");
    const spans = pageSpans(source);
    // Only the real "[Page 1]" marker counts, so one span; the notice is not a
    // second page.
    expect(spans).toHaveLength(1);
  });

  it("a whole-document no-text-layer notice with no markers is null", () => {
    const source =
      "[This PDF has no text layer, so its content cannot be read. It is most likely a scanned document that needs OCR.]";
    expect(pageSpans(source)).toBeNull();
  });

  it("text with no markers (DOCX-style '## Page 1') is null", () => {
    const source = ["## Page 1", "Some docx body.", "More body."].join("\n");
    expect(pageSpans(source)).toBeNull();
  });

  it("empty source is null", () => {
    expect(pageSpans("")).toBeNull();
  });

  it("pageForOffset returns null outside every span", () => {
    const spans = pageSpans(pdf(["a", "b"]))!;
    expect(pageForOffset(spans, -1)).toBeNull();
  });
});
