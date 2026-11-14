// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Theme and modal labelling (W27).
 *
 * A dark-mode visitor must see the dark frame on the very first paint — before
 * React hydrates and before the profile loads — so the inline head script
 * (themeScript.ts) resolves the theme from the localStorage mirror up front.
 * First paint is read from a snapshot an addInitScript records at
 * DOMContentLoaded, so the assertion never races the hydration that follows.
 *
 * A signed-in user's stored preference then wins, and Appearance switches the
 * theme without a reload. The two modal checks prove W27's labelling resolves a
 * dialog by its accessible name (the last breadcrumb names it when no explicit
 * title is given).
 *
 * Auth: the first group opts out of the signed-in fixture (a public visitor on
 * /login); the rest use the storageState fixture (see e2e/fixtures.ts). The
 * browser stack needs the full app, so this spec runs in hosted CI.
 */
import { test, expect, type Page } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";

/** Must match THEME_MIRROR_KEY in frontend/src/app/lib/theme.ts. */
const MIRROR_KEY = "mike-theme";

type FirstPaint = { dark: boolean; colorScheme: string };

/**
 * Seeds the localStorage mirror and, at DOMContentLoaded, records whether the
 * root is already dark — before any React code runs. The init script runs at
 * document start, so the mirror is set in time for the head script to read it
 * on this same load, and the listener is registered before DOMContentLoaded.
 */
async function seedMirrorAndRecord(page: Page, mirror: string): Promise<void> {
    await page.addInitScript(
        ([key, value]) => {
            try {
                window.localStorage.setItem(key, value);
            } catch {
                // A blocked store only costs the first-paint hint; ignore.
            }
            document.addEventListener("DOMContentLoaded", () => {
                const root = document.documentElement;
                (
                    window as Window & { __firstPaint?: FirstPaint }
                ).__firstPaint = {
                    dark: root.classList.contains("dark"),
                    colorScheme: root.style.colorScheme,
                };
            });
        },
        [MIRROR_KEY, mirror],
    );
}

const firstPaint = (page: Page): Promise<FirstPaint | undefined> =>
    page.evaluate(
        () => (window as Window & { __firstPaint?: FirstPaint }).__firstPaint,
    );

const rootIsDark = (page: Page): Promise<boolean> =>
    page.evaluate(() => document.documentElement.classList.contains("dark"));

test.describe("first paint before hydration", () => {
    // A public visitor: no signed-in session, so /login renders on its own.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a dark mirror paints dark under a light device scheme", async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await seedMirrorAndRecord(page, "dark");
        await page.goto("/login");

        expect(await firstPaint(page)).toEqual({
            dark: true,
            colorScheme: "dark",
        });

        // The body background is the dark --background, resolved live so the
        // assertion survives a token-value change.
        const { bodyBg, tokenBg } = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--background)";
            document.body.appendChild(probe);
            const resolved = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
                bodyBg: getComputedStyle(document.body).backgroundColor,
                tokenBg: resolved,
            };
        });
        expect(bodyBg).toBe(tokenBg);
        expect(await rootIsDark(page)).toBe(true);
    });

    test("a system mirror follows an emulated dark device scheme", async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: "dark" });
        await seedMirrorAndRecord(page, "system");
        await page.goto("/login");

        expect(await firstPaint(page)).toEqual({
            dark: true,
            colorScheme: "dark",
        });
        expect(await rootIsDark(page)).toBe(true);
    });
});

test.describe("the signed-in appearance setting", () => {
    test("the stored preference wins and switches without a reload", async ({
        page,
    }) => {
        await page.goto("/settings/appearance");

        const group = page.getByRole("radiogroup", { name: "Theme" });
        await expect(group).toBeVisible();
        for (const name of ["System", "Light", "Dark"]) {
            await expect(group.getByRole("radio", { name })).toBeVisible();
        }
        // Exactly one option carries the stored preference.
        await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);

        // A marker that a reload would wipe, so "without a reload" is testable.
        await page.evaluate(() => {
            (window as Window & { __noReload?: number }).__noReload = 1;
        });

        await group.getByRole("radio", { name: "Dark" }).click();
        await expect(group.getByRole("radio", { name: "Dark" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await expect.poll(() => rootIsDark(page)).toBe(true);

        await group.getByRole("radio", { name: "Light" }).click();
        await expect(group.getByRole("radio", { name: "Light" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await expect.poll(() => rootIsDark(page)).toBe(false);

        expect(
            await page.evaluate(
                () =>
                    (window as Window & { __noReload?: number }).__noReload,
            ),
        ).toBe(1);

        // The stored profile wins on a fresh load.
        await group.getByRole("radio", { name: "Dark" }).click();
        await expect.poll(() => rootIsDark(page)).toBe(true);
        await page.reload();
        await expect(
            page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", {
                name: "Dark",
            }),
        ).toHaveAttribute("aria-checked", "true");
        await expect.poll(() => rootIsDark(page)).toBe(true);

        await expectAccessibleInEveryTheme(page, "/settings/appearance");

        // Leave the shared worker account on System for later tests.
        await page
            .getByRole("radiogroup", { name: "Theme" })
            .getByRole("radio", { name: "System" })
            .click();
        await expect(
            page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", {
                name: "System",
            }),
        ).toHaveAttribute("aria-checked", "true");
    });
});

test.describe("labelled dialogs", () => {
    test("the New project modal resolves by its accessible name", async ({
        page,
    }) => {
        await page.goto("/projects");
        await page.getByRole("button", { name: "New project" }).click();
        // No explicit title: the last breadcrumb (the first step) names it.
        await expect(
            page.getByRole("dialog", { name: "Details" }),
        ).toBeVisible();
    });

    test("the Quick actions modal resolves by its accessible name", async ({
        page,
    }) => {
        await page.goto("/assistant");
        await page
            .getByRole("button", { name: "Configure quick actions" })
            .click();
        await expect(
            page.getByRole("dialog", { name: "Quick Actions" }),
        ).toBeVisible();
    });
});
