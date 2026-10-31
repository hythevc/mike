// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmptyStatesPreview } from "./emptyStatesPreview";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("isEmptyStatesPreview", () => {
    it("previews empty states outside production builds", () => {
        vi.stubEnv("NODE_ENV", "development");

        expect(isEmptyStatesPreview(new URLSearchParams("emptyStates=1"))).toBe(
            true,
        );
        expect(isEmptyStatesPreview(new URLSearchParams("emptyStates=0"))).toBe(
            false,
        );
        expect(isEmptyStatesPreview(new URLSearchParams(""))).toBe(false);
        expect(isEmptyStatesPreview(null)).toBe(false);
    });

    it("never hides real rows in a production build", () => {
        vi.stubEnv("NODE_ENV", "production");

        expect(isEmptyStatesPreview(new URLSearchParams("emptyStates=1"))).toBe(
            false,
        );
    });
});
