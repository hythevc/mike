// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import AboutPage from "./page";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Settings About page", () => {
  it("shows the version and a source link at the running commit, with attribution", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
    vi.stubEnv("NEXT_PUBLIC_MIKE_VERSION", "2.1.0");
    render(<AboutPage />);

    expect(screen.getByText("2.1.0")).toBeInTheDocument();
    expect(screen.getByText(COMMIT.slice(0, 12))).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View the source at this version" }),
    ).toHaveAttribute("href", `${brand.sourceRepositoryUrl}/tree/${COMMIT}`);
    expect(
      screen.getByText(brand.upstreamAttribution.notice),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Licence" })).toHaveAttribute(
      "href",
      `${brand.sourceRepositoryUrl}/blob/${COMMIT}/LICENSE`,
    );
  });
});
