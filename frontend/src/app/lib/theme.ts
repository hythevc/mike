export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/**
 * The localStorage key the pre-paint head script (themeScript.ts) and
 * `applyTheme` share: it mirrors the saved preference so the first paint can
 * be the right theme before the profile loads.
 */
export const THEME_MIRROR_KEY = "mike-theme";

/**
 * The browser-chrome tint (`<meta name="theme-color">`) per resolved theme,
 * matching the app background so the mobile status bar does not flash.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
    light: "#f9fafb",
    dark: "#0b0f14",
};

export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", enabled);
    document.documentElement.style.colorScheme = enabled ? "dark" : "light";
}

/** The effective light/dark for a preference, resolving `system` against the device query. */
export function resolveTheme(
    preference: ThemePreference,
    prefersDark: boolean,
): ResolvedTheme {
    if (preference === "light" || preference === "dark") return preference;
    return prefersDark ? "dark" : "light";
}

/** Whether the device currently prefers a dark colour scheme. */
export function prefersDarkScheme(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The stored preference the pre-paint script mirrors; null when absent or unreadable. */
export function readThemeMirror(): ThemePreference | null {
    try {
        const value = window.localStorage.getItem(THEME_MIRROR_KEY);
        return value === "system" || value === "light" || value === "dark"
            ? value
            : null;
    } catch {
        return null;
    }
}

function writeThemeMirror(preference: ThemePreference): void {
    try {
        window.localStorage.setItem(THEME_MIRROR_KEY, preference);
    } catch {
        // A private window or blocked storage: the class is still applied; only
        // the next load's pre-paint hint is lost.
    }
}

function setThemeColorMeta(resolved: ResolvedTheme): void {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
}

/**
 * Applies a preference to the document root — the `.dark` class, `color-scheme`,
 * the `theme-color` meta and the localStorage mirror the pre-paint script reads
 * — and returns the resolved light/dark. The mode stays class-based (the axe
 * gate pins the same class). The DOM writes are skipped without a document; the
 * mirror write is always attempted so the next load's first paint matches.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
    const resolved = resolveTheme(preference, prefersDarkScheme());
    if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.classList.toggle("dark", resolved === "dark");
        root.style.colorScheme = resolved;
        setThemeColorMeta(resolved);
    }
    writeThemeMirror(preference);
    return resolved;
}

/**
 * Calls `onChange` whenever the device's colour-scheme preference flips, for a
 * user on System. Returns an unsubscribe; a no-op where matchMedia is absent.
 */
export function watchSystemTheme(
    onChange: (prefersDark: boolean) => void,
): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => onChange(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
}
