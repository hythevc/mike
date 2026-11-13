// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { matterJurisdictionsEnabled } from "./matterJurisdictionsFlag";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("matterJurisdictionsEnabled", () => {
    it("is off unless NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED says true", () => {
        for (const value of ["", "false", "1", "yes", "on"]) {
            vi.stubEnv("NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED", value);
            expect(matterJurisdictionsEnabled()).toBe(false);
        }
    });

    it("is off when the variable is not set at all", () => {
        vi.stubEnv("NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED", undefined);
        expect(matterJurisdictionsEnabled()).toBe(false);
    });

    it("is on for true, trimmed and in any case, as the server reads its own switch", () => {
        for (const value of ["true", "TRUE", " True "]) {
            vi.stubEnv("NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED", value);
            expect(matterJurisdictionsEnabled()).toBe(true);
        }
    });
});
