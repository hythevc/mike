// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { serializeProfile } from "../user.profile.serialization";
import { validateProfilePayload } from "../user.profile.validation";
import type { UserProfileRow } from "../user.profile.storage";
import type { RouterModelSelections } from "../../../lib/routerModels";

const NO_ROUTER_MODELS = {} as unknown as RouterModelSelections;

function profileRow(overrides: Partial<UserProfileRow>): UserProfileRow {
    return { onboarding_version: 1, ...overrides } as unknown as UserProfileRow;
}

describe("profile theme serialization", () => {
    it("emits theme 'system' for a null dark_mode and keeps darkMode false", () => {
        const profile = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ dark_mode: null }),
        );
        expect(profile.theme).toBe("system");
        expect(profile.darkMode).toBe(false);
    });

    it("emits 'dark' and 'light' for true and false, with darkMode in step", () => {
        const dark = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ dark_mode: true }),
        );
        expect(dark.theme).toBe("dark");
        expect(dark.darkMode).toBe(true);

        const light = serializeProfile(
            NO_ROUTER_MODELS,
            profileRow({ dark_mode: false }),
        );
        expect(light.theme).toBe("light");
        expect(light.darkMode).toBe(false);
    });
});

describe("profile theme validation", () => {
    function updateOf(body: unknown): { dark_mode?: boolean | null } {
        const result = validateProfilePayload(body);
        if (!result.ok) throw new Error(`unexpected rejection: ${result.detail}`);
        return result.update as unknown as { dark_mode?: boolean | null };
    }

    it("maps the three theme values to dark_mode", () => {
        expect(updateOf({ theme: "system" }).dark_mode).toBeNull();
        expect(updateOf({ theme: "dark" }).dark_mode).toBe(true);
        expect(updateOf({ theme: "light" }).dark_mode).toBe(false);
    });

    it("still accepts the legacy darkMode boolean", () => {
        expect(updateOf({ darkMode: true }).dark_mode).toBe(true);
        expect(updateOf({ darkMode: false }).dark_mode).toBe(false);
    });

    it("rejects an unknown theme value with a 4xx detail", () => {
        const result = validateProfilePayload({ theme: "midnight" });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.detail).toMatch(/system/);
    });

    it("rejects a non-string theme", () => {
        const result = validateProfilePayload({ theme: true });
        expect(result.ok).toBe(false);
    });

    it("lets theme win when both theme and the legacy boolean are sent", () => {
        expect(updateOf({ darkMode: true, theme: "system" }).dark_mode).toBeNull();
    });
});
