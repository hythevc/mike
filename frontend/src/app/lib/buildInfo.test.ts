// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import { getBuildInfo, repositoryFileUrl } from "./buildInfo";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBuildInfo", () => {
  it("links to the source at the running commit when the build is stamped", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", COMMIT);
    vi.stubEnv("NEXT_PUBLIC_MIKE_VERSION", "2.1.0");
    const info = getBuildInfo();
    expect(info.commit).toBe(COMMIT);
    expect(info.shortCommit).toBe(COMMIT.slice(0, 12));
    expect(info.version).toBe("2.1.0");
    expect(info.repositoryUrl).toBe(brand.sourceRepositoryUrl);
    expect(info.sourceTreeUrl).toBe(`${brand.sourceRepositoryUrl}/tree/${COMMIT}`);
    expect(info.upstream.notice).toBe(brand.upstreamAttribution.notice);
    expect(repositoryFileUrl(info, "LICENSE")).toBe(
      `${brand.sourceRepositoryUrl}/blob/${COMMIT}/LICENSE`,
    );
  });

  it("falls back to the repository root and HEAD when the build is unstamped", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "");
    vi.stubEnv("NEXT_PUBLIC_MIKE_VERSION", "");
    const info = getBuildInfo();
    expect(info.commit).toBeNull();
    expect(info.shortCommit).toBeNull();
    expect(info.version).toBeNull();
    expect(info.sourceTreeUrl).toBe(brand.sourceRepositoryUrl);
    expect(repositoryFileUrl(info, "NOTICE.md")).toBe(
      `${brand.sourceRepositoryUrl}/blob/HEAD/NOTICE.md`,
    );
  });

  it("treats a short or malformed commit as unstamped", () => {
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "abc123");
    expect(getBuildInfo().commit).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "Z".repeat(40));
    expect(getBuildInfo().commit).toBeNull();
  });
});
