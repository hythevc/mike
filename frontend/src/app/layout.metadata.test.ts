// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";

// The root layout pulls in the whole provider tree only to render; the
// metadata object does not need it, so keep the import light.
vi.mock("@/app/components/providers", () => ({
    Providers: ({ children }: { children: React.ReactNode }) => children,
}));

import { metadata } from "./layout";

describe("root layout metadata", () => {
    it("reads the title, siteName and OG image from the brand module", () => {
        expect(String(metadata.title)).toContain(brand.productName);
        expect(String(metadata.title)).not.toContain(brand.upstreamAttribution.projectName);
        expect(metadata.openGraph?.siteName).toBe(brand.productName);
        expect(metadata.metadataBase?.toString()).toContain(
            new URL(brand.appUrl).host,
        );
        expect(JSON.stringify(metadata.openGraph?.images)).toContain(
            brand.assets.ogImage,
        );
        expect(JSON.stringify(metadata.twitter?.images)).toContain(
            brand.assets.ogImage,
        );
    });

    it("ships an apple-touch-icon referenced by the metadata", () => {
        expect(JSON.stringify(metadata.icons)).toContain("/apple-touch-icon.png");
        // The frontend test runner's cwd is the frontend package root.
        expect(existsSync(join(process.cwd(), "public/apple-touch-icon.png"))).toBe(
            true,
        );
    });
});