import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applyDarkMode,
    applyTheme,
    resolveTheme,
    readThemeMirror,
    THEME_COLOR,
    THEME_MIRROR_KEY,
} from "./theme";
import { themeScript } from "./themeScript";

function stubMatchMedia(prefersDark: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: prefersDark,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    document.head.innerHTML = "";
    try {
        window.localStorage.clear();
    } catch {
        // ignore
    }
});

describe("applyDarkMode", () => {
    it("enables dark colors on the document root", () => {
        applyDarkMode(true);
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("returns the document root to light mode", () => {
        document.documentElement.classList.add("dark");
        applyDarkMode(false);
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("does nothing when rendered without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(() => applyDarkMode(true)).not.toThrow();
    });
});

describe("resolveTheme", () => {
    it("follows the device query for system", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
    });

    it("forces the chosen theme regardless of the device", () => {
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
    });
});

describe("applyTheme", () => {
    it("sets the class, color-scheme, the mirror and the theme-color meta", () => {
        document.head.innerHTML =
            '<meta name="theme-color" content="placeholder" />';
        stubMatchMedia(false);

        const resolved = applyTheme("dark");

        expect(resolved).toBe("dark");
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
        expect(readThemeMirror()).toBe("dark");
        expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe("dark");
        expect(
            document
                .querySelector('meta[name="theme-color"]')
                ?.getAttribute("content"),
        ).toBe(THEME_COLOR.dark);
    });

    it("resolves system against the device query", () => {
        stubMatchMedia(true);
        expect(applyTheme("system")).toBe("dark");
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        // The mirror stores the preference, not the resolved value.
        expect(readThemeMirror()).toBe("system");
    });
});

describe("the pre-paint theme script", () => {
    it("parses as a function", () => {
        expect(() => new Function(themeScript)).not.toThrow();
    });

    it("adds .dark from a dark mirror even under a light media query", () => {
        window.localStorage.setItem(THEME_MIRROR_KEY, "dark");
        stubMatchMedia(false);
        document.head.innerHTML =
            '<meta name="theme-color" content="placeholder" />';

        // Running the inlined script is what happens before any React code.
        new Function(themeScript)();

        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
        expect(
            document
                .querySelector('meta[name="theme-color"]')
                ?.getAttribute("content"),
        ).toBe(THEME_COLOR.dark);
    });

    it("follows the device for a system mirror under a dark media query", () => {
        window.localStorage.setItem(THEME_MIRROR_KEY, "system");
        stubMatchMedia(true);

        new Function(themeScript)();

        expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
});
