// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HOME_COPY } from "@/content/site/home";
import { HomeContent } from "./HomeContent";

describe("HomeContent", () => {
    it("renders one h1, the facts as a list and the disclaimer", () => {
        render(<HomeContent />);
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HOME_COPY.headline);
        for (const fact of HOME_COPY.facts) {
            expect(screen.getByRole("heading", { level: 3, name: fact.title })).toBeInTheDocument();
        }
        expect(screen.getByRole("heading", { level: 2, name: HOME_COPY.limitsHeading })).toBeInTheDocument();
        expect(screen.getByText(HOME_COPY.disclaimer)).toBeInTheDocument();
    });

    it("offers the account, sign-in and documentation links", () => {
        render(<HomeContent />);
        expect(screen.getByRole("link", { name: HOME_COPY.primaryAction })).toHaveAttribute("href", "/signup");
        expect(screen.getByRole("link", { name: HOME_COPY.secondaryAction })).toHaveAttribute("href", "/login");
        expect(screen.getByRole("link", { name: HOME_COPY.docsAction })).toHaveAttribute("href", "/docs");
    });

    it("makes no accuracy or time-saving claim", () => {
        const text = JSON.stringify(HOME_COPY).toLowerCase();
        expect(text).not.toMatch(/\d\s*%/);
        expect(text).not.toMatch(/\bverified\b/);
        expect(text).not.toMatch(/\baccurate\b|\baccuracy\b/);
    });
});
