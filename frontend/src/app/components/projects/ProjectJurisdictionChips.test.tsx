// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getJurisdictionRegistry,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";
import { clearJurisdictionRegistryCache } from "@/app/hooks/useJurisdictionRegistry";
import { ProjectJurisdictionChips } from "./ProjectJurisdictionChips";

vi.mock("@/app/lib/mikeApi", () => ({
    getJurisdictionRegistry: vi.fn(),
}));

const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "PT", name: "Portugal", kind: "country", parent: null, languages: ["pt"] },
        { code: "EU", name: "European Union", kind: "supranational", parent: null, languages: ["en", "fr", "de"] },
    ],
    working_languages: [],
    max_jurisdictions: 10,
};

describe("ProjectJurisdictionChips", () => {
    beforeEach(() => {
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockReset();
    });

    it("shows a chip for each of the project's jurisdictions, by name", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        render(<ProjectJurisdictionChips codes={["PT", "EU"]} />);
        const list = await screen.findByRole("list", { name: "Jurisdictions of this project" });
        expect(
            within(list)
                .getAllByRole("listitem")
                .map((item) => item.textContent),
        ).toEqual(["Portugal", "European Union"]);
    });

    it("holds the row's place with one placeholder per chip while the names load", () => {
        vi.mocked(getJurisdictionRegistry).mockReturnValue(new Promise(() => {}));
        const { container } = render(<ProjectJurisdictionChips codes={["PT", "EU"]} />);
        expect(screen.queryByRole("list")).toBeNull();
        expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
        // The placeholders say nothing to a screen reader.
        expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    });

    it("shows the codes themselves when the names cannot be read", async () => {
        vi.mocked(getJurisdictionRegistry).mockRejectedValue(new Error("offline"));
        render(<ProjectJurisdictionChips codes={["PT", "EU"]} />);
        const list = await screen.findByRole("list", { name: "Jurisdictions of this project" });
        expect(
            within(list)
                .getAllByRole("listitem")
                .map((item) => item.textContent),
        ).toEqual(["PT", "EU"]);
    });

    it("draws nothing for a project with no jurisdictions", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const { container } = render(<ProjectJurisdictionChips codes={[]} />);
        await waitFor(() => expect(getJurisdictionRegistry).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });

    it("sits in the page header's gutters", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const { container } = render(<ProjectJurisdictionChips codes={["PT"]} />);
        await screen.findByRole("list");
        expect(container.firstElementChild).toHaveClass("mx-3", "md:mx-6.5");
    });
});
