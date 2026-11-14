// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";

/**
 * The command menu, its sidebar trigger, and the help menu, signed in on
 * /assistant. The stack is required, so these run in hosted CI, not locally.
 */
test.describe("Command menu and help menu", () => {
    test("Control+K opens a labelled dialog with a combobox", async ({
        page,
    }) => {
        await page.goto("/assistant");
        await expect(page).toHaveURL(/\/assistant/, { timeout: 15_000 });

        await page.keyboard.press("Control+k");
        const dialog = page.getByRole("dialog", { name: "Command menu" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("combobox")).toBeVisible();
    });

    test("typing lists the Tabular reviews link and Enter navigates there", async ({
        page,
    }) => {
        await page.goto("/assistant");
        await page.keyboard.press("Control+k");
        const dialog = page.getByRole("dialog", { name: "Command menu" });
        await dialog.getByRole("combobox").fill("tabular");

        const option = dialog.getByRole("option", { name: "Tabular Review" });
        await expect(option).toHaveAttribute("href", "/tabular-reviews");
        await dialog.getByRole("combobox").press("Enter");
        await expect(page).toHaveURL(/\/tabular-reviews/);
    });

    test("the sidebar trigger opens the menu and Escape returns focus to it", async ({
        page,
    }) => {
        await page.goto("/assistant");
        const trigger = page
            .getByRole("button", { name: /^Search/ })
            .first();
        await trigger.focus();
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Command menu" });
        await expect(dialog).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test("the command menu passes the accessibility gate in both themes", async ({
        page,
    }) => {
        await page.goto("/assistant");
        await page.keyboard.press("Control+k");
        await expect(
            page.getByRole("dialog", { name: "Command menu" }),
        ).toBeVisible();
        await expectAccessibleInEveryTheme(page, "/assistant");
    });

    test("the help menu lists its destinations and opens the shortcuts dialog", async ({
        page,
    }) => {
        await page.goto("/assistant");
        await page
            .getByRole("button", { name: /^Account menu(?: —|$)/ })
            .click();
        const menu = page.getByRole("menu");

        const docs = menu.getByRole("menuitem", { name: "Documentation" });
        await expect(docs).toHaveAttribute("href", /^https?:\/\//);
        await expect(
            menu.getByRole("menuitem", { name: "Support" }),
        ).toHaveAttribute("href", "/support");
        await expect(
            menu.getByRole("menuitem", { name: "About" }),
        ).toHaveAttribute("href", "/settings/about");
        await expect(
            menu.getByRole("menuitem", { name: "Source code" }),
        ).toHaveAttribute("href", "/source");
        await expect(
            menu.getByRole("menuitem", { name: "Terms" }),
        ).toHaveAttribute("href", "/legal/terms");
        await expect(
            menu.getByRole("menuitem", { name: "Privacy" }),
        ).toHaveAttribute("href", "/legal/privacy");

        await menu.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
        const shortcuts = page.getByRole("dialog", {
            name: "Keyboard shortcuts",
        });
        await expect(shortcuts).toBeVisible();
        await expectAccessibleInEveryTheme(page, "/assistant");
    });
});
