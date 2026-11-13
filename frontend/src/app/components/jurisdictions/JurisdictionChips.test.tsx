// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { JurisdictionEntry } from "@/app/lib/mikeApi";
import { JurisdictionChips } from "./JurisdictionChips";
import { jurisdictionLabel, jurisdictionName } from "./jurisdictionLabels";

const ENTRIES: JurisdictionEntry[] = [
    { code: "US", name: "United States", kind: "country", parent: null, languages: ["en"] },
    { code: "US_CA", name: "California", kind: "subdivision", parent: "US", languages: ["en"] },
    { code: "BR_SP", name: "São Paulo", kind: "subdivision", parent: "BR", languages: ["pt"] },
];

describe("jurisdiction labels", () => {
    it("names a registry code", () => {
        expect(jurisdictionName("US_CA", ENTRIES)).toBe("California");
        expect(jurisdictionLabel("US_CA", ENTRIES)).toBe("California (US_CA)");
        expect(jurisdictionLabel("BR_SP", ENTRIES)).toBe("São Paulo (BR_SP)");
    });

    it("shows a code the registry does not hold as the code", () => {
        expect(jurisdictionName("XX", ENTRIES)).toBe("XX");
        expect(jurisdictionLabel("XX", ENTRIES)).toBe("XX");
        expect(jurisdictionName("US", [])).toBe("US");
    });
});

describe("JurisdictionChips", () => {
    it("lists each jurisdiction by name, in order, under the label it is given", () => {
        render(
            <JurisdictionChips
                codes={["US_CA", "US", "BR_SP"]}
                entries={ENTRIES}
                label="Jurisdictions of this project"
            />,
        );
        const list = screen.getByRole("list", { name: "Jurisdictions of this project" });
        expect(
            within(list)
                .getAllByRole("listitem")
                .map((item) => item.textContent),
        ).toEqual(["California", "United States", "São Paulo"]);
    });

    it("carries the code in each chip's tooltip", () => {
        render(<JurisdictionChips codes={["US_CA"]} entries={ENTRIES} label="Jurisdictions" />);
        expect(screen.getByRole("listitem")).toHaveAttribute("title", "California (US_CA)");
    });

    it("is not something to press", () => {
        render(<JurisdictionChips codes={["US", "US_CA"]} entries={ENTRIES} label="Jurisdictions" />);
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("draws nothing for an empty list", () => {
        const { container } = render(
            <JurisdictionChips codes={[]} entries={ENTRIES} label="Jurisdictions" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("uses the text and surface roles whose contrast is held in both themes", () => {
        render(<JurisdictionChips codes={["US"]} entries={ENTRIES} label="Jurisdictions" />);
        const chip = screen.getByRole("listitem");
        expect(chip).toHaveClass("text-fg-subtle", "bg-surface", "border-border-strong");
        // No raw palette colour: those do not switch with the theme.
        expect(chip.className).not.toMatch(/gray-\d|#[0-9a-f]{3,6}/i);
    });

    it("lets a long name wrap instead of clipping it", () => {
        render(<JurisdictionChips codes={["US"]} entries={ENTRIES} label="Jurisdictions" />);
        const chip = screen.getByRole("listitem");
        expect(chip).toHaveClass("max-w-full");
        expect(chip.className).not.toMatch(/truncate|overflow-hidden/);
    });
});
