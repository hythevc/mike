// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PRICING_COPY } from "@/content/site/pricing";
import {
    INDEPENDENT_ASSESSMENT_FACT_ID,
    TRUST_STRIP_FACT_IDS,
    securityFactLine,
    securityFacts,
    type SecurityFact,
} from "@/content/site/securityFacts";
import { brand } from "@/shared/brand.generated";
import { TrustStrip } from "./TrustStrip";

describe("TrustStrip", () => {
    it("renders only lines that are facts of the registry, in the page's order", () => {
        render(<TrustStrip />);
        const list = screen.getByRole("list", { name: PRICING_COPY.trustHeading });
        const items = within(list).getAllByRole("listitem");

        // Every line is the registry's own sentence for a fact it holds.
        const registry = new Map(
            securityFacts().map((fact) => [fact.id, securityFactLine(fact)] as const),
        );
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            const id = item.getAttribute("data-fact");
            expect(id).not.toBeNull();
            expect(registry.has(id!), `${id} is a fact of the registry`).toBe(true);
            expect(item.textContent).toBe(registry.get(id!));
        }
        expect(items.map((item) => item.getAttribute("data-fact"))).toEqual([
            ...TRUST_STRIP_FACT_IDS,
        ]);
        // A subset: the security page lists more than the strip shows.
        expect(items.length).toBeLessThan(registry.size);
    });

    it("says that no outside party has assessed the service, rather than implying one has", () => {
        const { container } = render(<TrustStrip />);
        const line = container.querySelector(
            `[data-fact="${INDEPENDENT_ASSESSMENT_FACT_ID}"]`,
        );
        expect(line).toHaveTextContent(
            "No outside party has certified or audited this service yet.",
        );
    });

    it("links to the security page, where every fact is listed", () => {
        render(<TrustStrip />);
        const link = screen.getByRole("link", { name: PRICING_COPY.trustLink });
        expect(link).toHaveAttribute("href", brand.legalDocuments.security.url);
        expect(brand.legalDocuments.security.url).toBe("/security");
    });

    it("puts the date first on a fact that is not in place yet", () => {
        const planned: SecurityFact = {
            id: "example-planned",
            status: "planned",
            date: "2099-03",
            text: "An example fact that is not true yet.",
        };
        const inPlace: SecurityFact = {
            id: "example-in-place",
            status: "in place",
            text: "An example fact that is true today.",
        };
        render(<TrustStrip facts={[inPlace, planned]} />);
        const items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent(/^An example fact that is true today\.$/);
        expect(items[1]).toHaveTextContent(
            /^Planned for March 2099: An example fact that is not true yet\.$/,
        );
    });

    it("is plain text: no tick, shield, badge or image stands in for evidence", () => {
        const { container } = render(<TrustStrip />);
        const strip = container.querySelector('[data-slot="trust-strip"]') as HTMLElement;
        expect(strip).not.toBeNull();
        expect(strip.querySelector("svg, img, picture")).toBeNull();
        for (const element of [strip, ...strip.querySelectorAll("*")]) {
            const className = element.getAttribute("class") ?? "";
            expect(className).not.toMatch(/\brounded-full\b/);
            expect(className).not.toMatch(/\buppercase\b/);
            expect(className).not.toMatch(/\banimate-/);
        }
        // One link, and it is the way to the full list.
        expect(within(strip).getAllByRole("link")).toHaveLength(1);
    });
});
