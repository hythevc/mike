import { THEME_COLOR, THEME_MIRROR_KEY } from "./theme";

/**
 * The tiny script layout.tsx inlines in `<head>` so the theme is right on the
 * first paint, before React hydrates and before the profile loads. It reads
 * the localStorage mirror (the saved preference), resolves `system` against the
 * device's `prefers-color-scheme`, and sets `.dark`, `color-scheme` and the
 * `theme-color` meta on the document root. It runs ahead of all app code, is
 * wrapped in try/catch so a blocked storage read never breaks the page, and
 * defaults to System when the mirror is empty (a new or signed-out visitor).
 *
 * Built from the same constants as `applyTheme`, so the pre-paint theme and the
 * reconciled theme never drift. The enforced CSP is `frame-ancestors` only and
 * the report-only policy allows inline scripts, so this needs no header change.
 */
export const themeScript =
    `(function(){try{` +
    `var k=${JSON.stringify(THEME_MIRROR_KEY)};` +
    `var p=window.localStorage.getItem(k);` +
    `var dark=!!(p==="dark"||((p==="system"||p===null)&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));` +
    `var r=document.documentElement;` +
    `r.classList.toggle("dark",dark);` +
    `r.style.colorScheme=dark?"dark":"light";` +
    `var m=document.querySelector('meta[name="theme-color"]');` +
    `if(m)m.setAttribute("content",dark?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)});` +
    `}catch(e){}})();`;
