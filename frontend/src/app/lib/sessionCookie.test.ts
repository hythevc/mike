// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { hasSessionCookie, isSessionCookieName } from "./sessionCookie";

describe("isSessionCookieName", () => {
    it.each([
        "mike-session",
        "__Host-mike-session",
        "mike-session.1",
        "__Host-mike-session.2",
        "mike-session-code-verifier",
    ])("recognises %s", (name) => {
        expect(isSessionCookieName(name)).toBe(true);
    });

    it.each([
        "",
        "sidebarOpen",
        "mike-sessions",
        "my-mike-session",
        "__Secure-mike-session",
        "theme",
    ])("ignores %s", (name) => {
        expect(isSessionCookieName(name)).toBe(false);
    });
});

describe("hasSessionCookie", () => {
    it("is true when any cookie is a session cookie", () => {
        expect(hasSessionCookie(["theme", "__Host-mike-session.1"])).toBe(true);
    });

    it("is false with no cookies or only unrelated ones", () => {
        expect(hasSessionCookie([])).toBe(false);
        expect(hasSessionCookie(["theme", "sidebarOpen"])).toBe(false);
    });
});
