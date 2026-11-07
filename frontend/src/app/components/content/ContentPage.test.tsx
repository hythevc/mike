// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContentPage } from "./ContentPage";

const SAMPLE = [
    "> This is legal information, not legal advice.",
    "",
    "## A section",
    "",
    "Body text with a [link](/legal/privacy).",
    "",
    "| Provider | Region |",
    "| --- | --- |",
    "| Example | United States |",
].join("\n");

describe("ContentPage", () => {
    it("shows the draft banner and renders the markdown for a draft", () => {
        render(
            <ContentPage
                title="Terms of Service"
                markdown={SAMPLE}
                status="draft"
                version="0.1.0"
            />,
        );
        expect(
            screen.getByRole("heading", { level: 1, name: "Terms of Service" }),
        ).toBeVisible();
        expect(
            screen.getByText("Draft, not in effect, pending counsel review."),
        ).toBeVisible();
        expect(
            screen.getByText(/legal information, not legal advice/i),
        ).toBeVisible();
        expect(
            screen.getByRole("heading", { level: 2, name: "A section" }),
        ).toBeVisible();
        // The GFM table renders.
        expect(screen.getByRole("table")).toBeVisible();
        expect(screen.getByText("United States")).toBeVisible();
        expect(screen.getByText(/Version 0\.1\.0/)).toBeVisible();
    });

    it("omits the draft banner once a document is in effect", () => {
        render(
            <ContentPage
                title="Privacy Notice"
                markdown={SAMPLE}
                status="in-effect"
                version="1.0.0"
            />,
        );
        expect(
            screen.queryByText("Draft, not in effect, pending counsel review."),
        ).not.toBeInTheDocument();
        expect(screen.getByText(/In effect/)).toBeVisible();
    });
});
