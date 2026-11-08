// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { siteEnabled, siteIndexable, siteRobotsMetadata } from "./siteFlags";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("siteEnabled", () => {
    it("is off unless NEXT_PUBLIC_SITE_ENABLED is exactly 'true'", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "");
        expect(siteEnabled()).toBe(false);
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "1");
        expect(siteEnabled()).toBe(false);
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "TRUE");
        expect(siteEnabled()).toBe(false);
        vi.stubEnv("NEXT_PUBLIC_SITE_ENABLED", "true");
        expect(siteEnabled()).toBe(true);
    });
});

describe("siteIndexable", () => {
    it("is off unless NEXT_PUBLIC_SITE_INDEXABLE is exactly 'true'", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        expect(siteIndexable()).toBe(false);
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "yes");
        expect(siteIndexable()).toBe(false);
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        expect(siteIndexable()).toBe(true);
    });
});

describe("siteRobotsMetadata", () => {
    it("asks search engines to stay out while the site is not indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "");
        expect(siteRobotsMetadata()).toEqual({ index: false, follow: false });
    });

    it("leaves the default once the site is indexable", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        expect(siteRobotsMetadata()).toBeUndefined();
    });

    it("keeps a page out when it asks, even on an indexable site", () => {
        vi.stubEnv("NEXT_PUBLIC_SITE_INDEXABLE", "true");
        expect(siteRobotsMetadata({ noindex: true })).toEqual({
            index: false,
            follow: false,
        });
    });
});
