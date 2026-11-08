// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { hasSessionCookie, isSessionCookieName } from "./sessionCookie";

describe("isSessionCookieName", () => {
    it.each([
        "mike-session",
        "__Host-mike-session",
        "mike-session.0",
        "mike-session.1",
        "__Host-mike-session.2",
    ])("recognises %s", (name) => {
        expect(isSessionCookieName(name)).toBe(true);
    });

    it.each([
        "",
        "sidebarOpen",
        "mike-sessions",
        "my-mike-session",
        "__Secure-mike-session",
        "mike-session.",
        "mike-session.x",
        "theme",
    ])("ignores %s", (name) => {
        expect(isSessionCookieName(name)).toBe(false);
    });

    it.each(["mike-session-code-verifier", "__Host-mike-session-code-verifier"])(
        "ignores the PKCE verifier %s, which an abandoned sign-in leaves behind",
        (name) => {
            // Set the moment a provider's sign-in button is clicked and kept
            // for months unless that sign-in completes: it is not a session,
            // and counting it would hide the home page from that visitor.
            expect(isSessionCookieName(name)).toBe(false);
        },
    );
});

describe("hasSessionCookie", () => {
    it("is true when any cookie is a session cookie", () => {
        expect(hasSessionCookie(["theme", "__Host-mike-session.1"])).toBe(true);
    });

    it("is false with no cookies, only unrelated ones, or only the PKCE verifier", () => {
        expect(hasSessionCookie([])).toBe(false);
        expect(hasSessionCookie(["theme", "sidebarOpen"])).toBe(false);
        expect(hasSessionCookie(["theme", "mike-session-code-verifier"])).toBe(false);
    });
});
