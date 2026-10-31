import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SIGNED_IN_PATH,
    ONBOARDING_START_PATH,
    authErrorDescription,
    forgetPostOnboardingDestination,
    loginPathFor,
    postLoginDestination,
    postOnboardingDestination,
    rememberPostOnboardingDestination,
    safeAuthNext,
} from "./authRedirects";

const STORAGE_KEY = "auth:post-onboarding-destination";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("safeAuthNext", () => {
    it("allows known internal destinations with query parameters", () => {
        expect(safeAuthNext("/settings?emailChange=processed")).toBe(
            "/settings?emailChange=processed",
        );
        expect(safeAuthNext("/reset-password")).toBe("/reset-password");
        expect(safeAuthNext("/onboarding/profile")).toBe("/onboarding/profile");
        expect(safeAuthNext("/onboarding/invitations")).toBe("/onboarding/invitations");
    });

    it("allows deep links into the signed-in app", () => {
        expect(safeAuthNext("/projects/project-1")).toBe("/projects/project-1");
        expect(
            safeAuthNext("/projects/project-1/assistant/chat/chat-1?side=new"),
        ).toBe("/projects/project-1/assistant/chat/chat-1?side=new");
        expect(safeAuthNext("/assistant/chat/chat-1")).toBe(
            "/assistant/chat/chat-1",
        );
        expect(safeAuthNext("/settings/security")).toBe("/settings/security");
    });

    it.each([
        "assistant",
        "https://evil.example",
        "//evil.example/path",
        "/unknown",
        "/settings\\evil",
        "/settings\n/assistant",
        "/projectsx",
        "/projects/../api/chat",
        "/projects/%2e%2e/auth/callback?code=stolen",
        "/auth/callback?code=stolen",
        "/api/chat",
    ])("rejects unsafe destination %s", (candidate) => {
        expect(safeAuthNext(candidate)).toBe("/assistant");
    });

    it("uses a caller-provided fallback when no destination is supplied", () => {
        expect(safeAuthNext(undefined, "/login")).toBe("/login");
    });

    it("accepts every top-level page of the signed-in app", () => {
        // A new page under (pages)/ must be added to APP_ROUTE_ROOTS, or a
        // link to it is silently dropped at sign-in.
        const pagesDir = join(__dirname, "..", "(pages)");
        const roots = readdirSync(pagesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => !name.startsWith("(") && !name.startsWith("_"));
        expect(roots.length).toBeGreaterThan(0);
        for (const root of roots) {
            expect(safeAuthNext(`/${root}/example`, "rejected")).toBe(
                `/${root}/example`,
            );
        }
    });
});

describe("loginPathFor", () => {
    it("carries a page of the app through sign-in", () => {
        expect(loginPathFor("/projects/project-1?tab=documents")).toBe(
            `/login?next=${encodeURIComponent("/projects/project-1?tab=documents")}`,
        );
    });

    it.each([
        undefined,
        null,
        "",
        DEFAULT_SIGNED_IN_PATH,
        "/login",
        "/onboarding/models",
        "https://evil.example/projects/1",
        "//evil.example/projects/1",
        "/source",
    ])("needs no next for %s", (destination) => {
        expect(loginPathFor(destination)).toBe("/login");
    });
});

describe("postLoginDestination", () => {
    it("returns to the page the user asked for", () => {
        expect(postLoginDestination("/projects/project-1")).toBe(
            "/projects/project-1",
        );
    });

    it.each([
        null,
        undefined,
        "",
        "/login",
        "/login?next=%2Flogin",
        "/reset-password",
        "/onboarding/models",
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
    ])("starts onboarding for %s", (next) => {
        expect(postLoginDestination(next)).toBe(ONBOARDING_START_PATH);
    });
});

describe("post-onboarding destination", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it("returns the page remembered for the same user", () => {
        rememberPostOnboardingDestination("user-1", "/projects/project-1?x=1");

        expect(postOnboardingDestination("user-1")).toBe(
            "/projects/project-1?x=1",
        );
        // Reading does not consume: the gate and the last step both ask.
        expect(postOnboardingDestination("user-1")).toBe(
            "/projects/project-1?x=1",
        );
    });

    it("ignores a page remembered for another user", () => {
        rememberPostOnboardingDestination("user-1", "/projects/project-1");

        expect(postOnboardingDestination("user-2")).toBe(
            DEFAULT_SIGNED_IN_PATH,
        );
    });

    it("defaults when nothing was remembered, and after forgetting", () => {
        expect(postOnboardingDestination("user-1")).toBe(
            DEFAULT_SIGNED_IN_PATH,
        );
        rememberPostOnboardingDestination("user-1", "/projects/project-1");
        forgetPostOnboardingDestination();
        expect(postOnboardingDestination("user-1")).toBe(
            DEFAULT_SIGNED_IN_PATH,
        );
    });

    it.each([
        "/onboarding/models",
        "/login",
        "/reset-password",
        "https://evil.example/projects/1",
        "/unknown",
    ])("does not remember %s", (destination) => {
        rememberPostOnboardingDestination("user-1", destination);

        expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it.each([
        ["malformed JSON", "{not json"],
        ["a non-object value", JSON.stringify("text")],
        ["a null value", "null"],
        ["a missing path", JSON.stringify({ userId: "user-1" })],
        ["a non-string path", JSON.stringify({ userId: "user-1", path: 7 })],
        [
            "an onboarding page",
            JSON.stringify({ userId: "user-1", path: "/onboarding/models" }),
        ],
        [
            "another site",
            JSON.stringify({ userId: "user-1", path: "//evil.example" }),
        ],
    ])("falls back to the default for %s", (_label, stored) => {
        window.sessionStorage.setItem(STORAGE_KEY, stored);

        expect(postOnboardingDestination("user-1")).toBe(
            DEFAULT_SIGNED_IN_PATH,
        );
    });

    it("loses only the deep link when storage is blocked", () => {
        const blocked = () => {
            throw new DOMException("blocked", "SecurityError");
        };
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
        vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

        expect(() =>
            rememberPostOnboardingDestination("user-1", "/projects/project-1"),
        ).not.toThrow();
        expect(postOnboardingDestination("user-1")).toBe(
            DEFAULT_SIGNED_IN_PATH,
        );
        expect(() => forgetPostOnboardingDestination()).not.toThrow();
    });
});

describe("authErrorDescription", () => {
    it("reads provider errors from query parameters or implicit-flow hashes", () => {
        expect(
            authErrorDescription("?error_description=Expired+link", ""),
        ).toBe("This confirmation link is invalid or has expired.");
        expect(
            authErrorDescription("", "#error=access_denied"),
        ).toBe("Authentication was cancelled or denied.");
        expect(authErrorDescription("?error=query_error", "")).toBe(
            "Authentication could not be completed. Please try again.",
        );
        expect(
            authErrorDescription("", "#error_description=Invalid+request"),
        ).toBe("This confirmation link is invalid or has expired.");
        expect(authErrorDescription("", "")).toBeNull();
    });
});
