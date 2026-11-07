// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/brand.generated";
import { SiteLogo } from "./site-logo";

describe("SiteLogo", () => {
    it("renders the configured product name and not the legacy name", () => {
        render(<SiteLogo />);
        expect(screen.getByText(brand.productName)).toBeInTheDocument();
        expect(document.body.textContent ?? "").not.toContain(brand.upstreamAttribution.projectName);
    });
});