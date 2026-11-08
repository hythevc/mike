/**
 * Accessibility (axe-core) scans of the web app's main pages, in the light
 * and the dark theme, through the shared gate in e2e/axe.ts:
 *
 *   /login (signed out), /assistant, /projects, /tabular-reviews,
 *   /settings, /workflows, /playbooks and /library.
 *
 * Each test loads a page, waits for a page-specific anchor (so the scan runs
 * against the rendered UI, not a loading state), pins the theme and scans.
 * Critical violations fail everywhere. Serious ones are held to the per-page
 * counts in e2e/axe-ratchet.json, which only ever go down. See the policy at
 * the top of e2e/axe.ts and "Accessibility gate" in docs/design-system.md.
 *
 * The last test checks the cascade itself in a real browser: a utility on a
 * glass control must beat the material class it refines.
 *
 * Auth: every page but /login runs signed in as this worker's account (the
 * storageState fixture in e2e/fixtures.ts).
 */
import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";
import { THEMES, expectAccessible, setTheme } from "./axe";

interface ScannedPage {
    path: string;
    /** An element that only appears once the page has rendered its content. */
    ready: (page: Page) => Locator;
}

const SIGNED_IN_PAGES: ScannedPage[] = [
    /* The initial view renders a greeting heading once loaded. */
    { path: "/assistant", ready: (page) => page.locator("h1, h2").first() },
    /* The New project button renders with the list. */
    {
        path: "/projects",
        ready: (page) => page.getByRole("button", { name: "New project" }),
    },
    {
        path: "/tabular-reviews",
        ready: (page) => page.getByRole("heading", { name: "Tabular Reviews" }),
    },
    {
        path: "/settings",
        ready: (page) => page.getByRole("heading", { name: "Settings" }),
    },
    {
        path: "/workflows",
        ready: (page) => page.getByRole("heading", { name: "Workflows" }),
    },
    {
        path: "/playbooks",
        ready: (page) => page.getByRole("table", { name: "Playbooks" }),
    },
    /* The Documents and Templates tabs render with the collection. */
    {
        path: "/library",
        ready: (page) => page.locator('[data-slot="tab-pill-button"]').first(),
    },
];

/* describe-scoped test.use so only these tests run without a stored session.
   A file-level test.use would wipe the storageState for the signed-in scans
   below. */
test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const theme of THEMES) {
        test(`/login in ${theme}: no critical violations, serious within the ratchet`, async ({
            page,
        }) => {
            await page.goto("/login");
            await expect(page).toHaveURL(/\/login/);
            /* The email field renders once the page is interactive. */
            await expect(page.locator("#email")).toBeVisible();

            await expectAccessible(page, { name: "/login", theme });
        });
    }
});

for (const { path, ready } of SIGNED_IN_PAGES) {
    for (const theme of THEMES) {
        test(`${path} in ${theme}: no critical violations, serious within the ratchet`, async ({
            page,
        }) => {
            await page.goto(path);
            await expect(page).toHaveURL(new RegExp(`${path}(?:[/?#]|$)`));
            await expect(ready(page)).toBeVisible();

            await expectAccessible(page, { name: path, theme });
        });
    }
}

/* The glass material classes sit in the components cascade layer, so the
   active tab pill's own fill wins over the translucent fill of
   `liquid-glass-subtle` it is drawn on. The active fill is the semantic
   `bg-app-surface-active`, which differs from the material in BOTH themes; the
   earlier `bg-white` collapsed onto the material in the dark theme, so the
   active tab differed from the others only by its text color there. Class-name
   unit tests cannot see this; the computed style can, so the check runs in
   both themes. */
for (const theme of THEMES) {
    test(`the active tab pill on /workflows paints its active fill, not the glass material (${theme})`, async ({
        page,
    }) => {
        await page.goto("/workflows");
        await expect(
            page.getByRole("heading", { name: "Workflows" }),
        ).toBeVisible();
        await setTheme(page, theme);

        const pill = page
            .locator('[data-slot="tab-pill-button"][aria-pressed="true"]')
            .first();
        await expect(pill).toBeVisible();

        /* Resolve both candidate fills on probe elements, so the check does
           not hard-code either color. */
        const fills = await page.evaluate(() => {
            const fillOf = (className: string) => {
                const probe = document.createElement("div");
                probe.className = className;
                document.body.append(probe);
                const fill = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return fill;
            };
            return {
                active: fillOf("bg-app-surface-active"),
                material: fillOf("liquid-glass-subtle"),
            };
        });
        expect(fills.active).not.toBe(fills.material);

        await expect
            .poll(() =>
                pill.evaluate(
                    (element) => getComputedStyle(element).backgroundColor,
                ),
            )
            .toBe(fills.active);
    });
}
