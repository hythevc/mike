// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    usePathname: () => "/docs",
}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("(site) layout", () => {
    it("wraps its pages in the site frame and renders per request", async () => {
        const { default: SiteLayout, dynamic } = await import("./layout");
        render(
            <SiteLayout>
                <main>page</main>
            </SiteLayout>,
        );
        expect(screen.getByRole("banner")).toBeInTheDocument();
        expect(screen.getByRole("contentinfo")).toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveTextContent("page");
        expect(dynamic).toBe("force-dynamic");
    });

    it("asks search engines to stay out until the build is marked indexable", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        const { metadata } = await import("./layout");
        expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it("leaves indexing to the pages once the build is marked indexable", async () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        const { metadata } = await import("./layout");
        expect(metadata.robots).toBeUndefined();
    });
});
