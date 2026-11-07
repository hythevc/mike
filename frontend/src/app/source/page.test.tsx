// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import SourcePage from "./page";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public /source page", () => {
  it("links to the source at the running commit and credits the upstream project", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
    vi.stubEnv("NEXT_PUBLIC_MIKE_VERSION", "2.1.0");
    render(<SourcePage />);

    const sourceLink = screen.getByRole("link", {
      name: "View the source at this version",
    });
    expect(sourceLink).toHaveAttribute(
      "href",
      `${brand.sourceRepositoryUrl}/tree/${COMMIT}`,
    );
    // The upstream attribution is shown verbatim from the brand configuration.
    expect(
      screen.getByText(brand.upstreamAttribution.notice),
    ).toBeInTheDocument();
    expect(screen.getByText(/AGPL-3\.0-only/)).toBeInTheDocument();
  });

  it("still renders a source link when the build is unstamped", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "");
    render(<SourcePage />);
    expect(
      screen.getByRole("link", { name: "View the source at this version" }),
    ).toHaveAttribute("href", brand.sourceRepositoryUrl);
  });
});
