// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QUOTE_MARKER_LABELS } from "@/app/components/tabular/tabularQuoteLabels";
import { HOME_COPY } from "@/content/site/home";
import { VIGNETTE_PLACEHOLDERS } from "@/content/site/placeholders";
import { HomeContent } from "./HomeContent";

const PRIMARY = '[data-slot="primary-action"]';

/** Every piece of text an element shows, one entry per text node. */
function textNodes(root: Element): string[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (text) found.push(text);
    }
    return found;
}

const classesOf = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/);

describe("HomeContent", () => {
    it("has one focal point: the headline, its lede and one filled action", () => {
        const { container } = render(<HomeContent />);
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HOME_COPY.headline);

        const hero = container.querySelector('[data-slot="home-hero"]') as HTMLElement;
        expect(hero).not.toBeNull();
        expect(within(hero).getByRole("heading", { level: 1 })).toBeInTheDocument();
        expect(within(hero).getByText(HOME_COPY.lede)).toBeInTheDocument();
        expect(within(hero).getByText(HOME_COPY.actionNote)).toBeInTheDocument();

        // One filled action on the whole page, and it is the hero's.
        const primary = container.querySelectorAll(PRIMARY);
        expect(primary).toHaveLength(1);
        expect(hero.contains(primary[0])).toBe(true);
        expect(primary[0]).toHaveTextContent(HOME_COPY.primaryAction);
        expect(primary[0]).toHaveAttribute("href", "/signup");
        // 44px tall, so it is easy to press with a thumb.
        expect(classesOf(primary[0])).toContain("h-11");

        // Sign-in and the documentation step down: links, not second buttons.
        const signIn = within(hero).getByRole("link", { name: HOME_COPY.secondaryAction });
        const docs = within(hero).getByRole("link", { name: HOME_COPY.docsAction });
        for (const link of [signIn, docs]) {
            expect(link).not.toHaveAttribute("data-slot");
            expect(classesOf(link)).toContain("underline");
            expect(classesOf(link)).toContain("min-h-11");
            expect(link.className).not.toMatch(/\bbg-/);
        }
        // In reading order: the action first, then the two links.
        const order = within(hero)
            .getAllByRole("link")
            .map((link) => link.textContent);
        expect(order).toEqual([
            HOME_COPY.primaryAction,
            HOME_COPY.secondaryAction,
            HOME_COPY.docsAction,
        ]);
    });

    it("offers the account, sign-in and documentation links", () => {
        render(<HomeContent />);
        expect(screen.getByRole("link", { name: HOME_COPY.primaryAction })).toHaveAttribute("href", "/signup");
        expect(screen.getByRole("link", { name: HOME_COPY.secondaryAction })).toHaveAttribute("href", "/login");
        expect(screen.getByRole("link", { name: HOME_COPY.docsAction })).toHaveAttribute("href", "/docs");
    });

    it("sets the section headings as plain headings, with no uppercase eyebrow", () => {
        const { container } = render(<HomeContent />);
        const headings = screen.getAllByRole("heading", { level: 2 });
        expect(headings.map((heading) => heading.textContent)).toEqual([
            HOME_COPY.stepsHeading,
            HOME_COPY.factsHeading,
            HOME_COPY.limitsHeading,
        ]);
        for (const heading of headings) {
            const classes = classesOf(heading);
            expect(classes).not.toContain("uppercase");
            expect(classes.some((name) => /^tracking-(?:wide|wider|widest)$/.test(name))).toBe(
                false,
            );
            // A heading reads as one by its size, in the primary text colour,
            // not by a small muted label.
            expect(classes).toContain("text-2xl");
            expect(classes).toContain("text-fg");
            expect(classes).not.toContain("text-fg-muted");
            expect(classes).not.toContain("text-sm");
        }
        // Nowhere on the page, not only on the headings.
        for (const element of container.querySelectorAll("*")) {
            const classes = classesOf(element);
            expect(classes).not.toContain("uppercase");
            expect(classes.some((name) => /^tracking-(?:wide|wider|widest)$/.test(name))).toBe(
                false,
            );
        }
    });

    it("keeps the headings in order: one h1, the sections under it, the steps under theirs", () => {
        render(<HomeContent />);
        const levels = screen
            .getAllByRole("heading")
            .map((heading) => Number(heading.tagName.slice(1)));
        expect(levels[0]).toBe(1);
        // No level is skipped on the way down.
        levels.forEach((level, index) => {
            if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
        });
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
    });

    it("lists the steps in order", () => {
        render(<HomeContent />);
        const section = screen.getByRole("region", { name: HOME_COPY.stepsHeading });
        const items = within(within(section).getByRole("list")).getAllByRole("listitem");
        expect(items).toHaveLength(HOME_COPY.steps.length);
        HOME_COPY.steps.forEach((step, index) => {
            expect(
                within(items[index]).getByRole("heading", { level: 3, name: step.title }),
            ).toBeInTheDocument();
            expect(items[index]).toHaveTextContent(step.body);
        });
        // A numbered list of text: the numbers are the list's own, and no
        // icon or badge stands in for them.
        expect(section.querySelector("ol")).not.toBeNull();
        expect(section.querySelector("svg, img")).toBeNull();
    });

    it("gives the facts as a short list with the page that backs each one, not as cards", () => {
        render(<HomeContent />);
        const section = screen.getByRole("region", { name: HOME_COPY.factsHeading });
        const terms = within(section).getAllByRole("term");
        const definitions = within(section).getAllByRole("definition");
        expect(terms.map((term) => term.textContent)).toEqual(
            HOME_COPY.facts.map((fact) => fact.title),
        );
        expect(definitions).toHaveLength(HOME_COPY.facts.length);
        HOME_COPY.facts.forEach((fact, index) => {
            expect(definitions[index]).toHaveTextContent(fact.body);
            if (fact.link) {
                expect(
                    within(definitions[index]).getByRole("link", { name: fact.link.label }),
                ).toHaveAttribute("href", fact.link.href);
            } else {
                expect(within(definitions[index]).queryByRole("link")).toBeNull();
            }
        });
        // A list, not a grid of equal cards: no card surface and no grid here.
        expect(section.querySelector(".liquid-glass-flat")).toBeNull();
        const list = section.querySelector("dl") as HTMLElement;
        expect(classesOf(list)).not.toContain("grid");
        expect(classesOf(list).some((name) => /grid-cols-/.test(name))).toBe(false);
        // The claims that can be checked each point at where to check them.
        const linked = HOME_COPY.facts.filter((fact) => fact.link).map((fact) => fact.link!.href);
        expect(linked).toEqual(
            expect.arrayContaining(["/security", "/pricing", "/source"]),
        );
    });

    it("says what it is not, and carries the disclaimer", () => {
        render(<HomeContent />);
        const section = screen.getByRole("region", { name: HOME_COPY.limitsHeading });
        expect(section).toHaveTextContent(HOME_COPY.limitsBody);
        expect(within(section).getByText(HOME_COPY.disclaimer)).toBeInTheDocument();
    });

    it("shows the illustration as a hidden picture, with its meaning in the text beside it", () => {
        const { container } = render(<HomeContent />);
        const vignette = container.querySelector('[data-slot="product-vignette"]') as HTMLElement;
        expect(vignette).not.toBeNull();
        expect(vignette).toHaveAttribute("aria-hidden", "true");
        expect(vignette).toHaveAttribute("inert");

        // The caption right after it says what it shows, for every reader.
        const caption = vignette.nextElementSibling as HTMLElement;
        expect(caption.tagName).toBe("FIGCAPTION");
        expect(caption).toHaveAttribute("data-slot", "product-vignette-caption");
        expect(caption).toHaveTextContent(HOME_COPY.vignetteCaption);
        expect(caption.closest('[aria-hidden="true"]')).toBeNull();
        expect(caption.closest("[inert]")).toBeNull();
        expect(screen.getByText(HOME_COPY.vignetteCaption)).toBe(caption);
        expect(caption.parentElement?.tagName).toBe("FIGURE");

        // Only invented text and the product's own marker labels are drawn.
        const allowed = new Set<string>([
            VIGNETTE_PLACEHOLDERS.label,
            VIGNETTE_PLACEHOLDERS.matterName,
            VIGNETTE_PLACEHOLDERS.documentName,
            ...VIGNETTE_PLACEHOLDERS.answers.flatMap((answer) => [
                answer.question,
                answer.answer,
                answer.quote,
            ]),
            QUOTE_MARKER_LABELS.found,
            QUOTE_MARKER_LABELS.not_found,
            // The quotation marks around each passage.
            "“",
            "”",
        ]);
        const shown = textNodes(vignette);
        expect(shown.length).toBeGreaterThan(0);
        for (const text of shown) expect(allowed.has(text), text).toBe(true);
        // The names on it are placeholders, and say so.
        expect(VIGNETTE_PLACEHOLDERS.matterName).toMatch(/^Example\b/);
        expect(VIGNETTE_PLACEHOLDERS.documentName).toMatch(/^Example\b/);
        expect(vignette).toHaveTextContent(VIGNETTE_PLACEHOLDERS.label);
    });

    it("makes no accuracy or time-saving claim", () => {
        const text = JSON.stringify(HOME_COPY).toLowerCase();
        expect(text).not.toMatch(/\d\s*%/);
        expect(text).not.toMatch(/\bverified\b/);
        expect(text).not.toMatch(/\baccurate\b|\baccuracy\b/);
        expect(text).not.toMatch(/\bfaster\b|\bsaves?\b|\bhours?\b/);
    });
});
