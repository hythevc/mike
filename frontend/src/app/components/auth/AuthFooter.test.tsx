// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { AuthFooter } from "./AuthFooter";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AuthFooter", () => {
  it("offers a Source link pointing at the repository at the running commit", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
    render(<AuthFooter />);
    const source = screen.getByRole("link", { name: "Source" });
    // The Source link carries the exact running commit (AGPL section 13).
    expect(source).toHaveAttribute(
      "href",
      `${brand.sourceRepositoryUrl}/tree/${COMMIT}`,
    );
    expect(source.getAttribute("href")).toContain(COMMIT);
  });

  it("links to the terms and privacy notices from the brand configuration", () => {
    render(<AuthFooter />);
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      brand.legalDocuments.terms.url,
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      brand.legalDocuments.privacy.url,
    );
  });

  it("still points at the repository when the build is unstamped", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "");
    render(<AuthFooter />);
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      brand.sourceRepositoryUrl,
    );
  });
});
