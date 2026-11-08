// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "./fixtures";
import { ensureOrganizationWorkspace } from "./users";
import { expectAccessibleInEveryTheme } from "./axe";

/**
 * The request desk, exercised end to end in an organization workspace: an org
 * admin logs a request, assigns it to themselves, moves it to In progress and
 * turns it into a matter, and the board passes the shared accessibility gate.
 */
test.describe("Intake triage board", () => {
    test("an org admin logs, assigns, progresses and converts a request", async ({
        page,
    }) => {
        test.setTimeout(60_000);

        const org = await ensureOrganizationWorkspace(page.request);

        await page.goto("/assistant");
        await expect(page).toHaveURL(/\/assistant/, { timeout: 15_000 });

        // Switch into the organization workspace from the account menu.
        await page.getByRole("button", { name: "Account menu" }).click();
        await page
            .getByRole("menuitemradio", { name: org.name })
            .click();

        // The Intake destination is shown only in an organization workspace.
        const primaryNav = page.getByRole("navigation", { name: "Primary" });
        const intakeLink = primaryNav.getByRole("link", { name: "Intake" });
        await expect(intakeLink).toBeVisible();
        await intakeLink.click();
        await expect(page).toHaveURL(/\/intake/);

        // Log a request through the New request modal.
        await page
            .getByRole("button", { name: "New request" })
            .first()
            .click();
        const dialog = page.getByRole("dialog", { name: "New request" });
        await dialog.getByLabel("Title").fill("Acme NDA review");
        await dialog
            .getByLabel("Details")
            .fill("Please review the mutual NDA before signing.");
        await dialog.getByRole("button", { name: "Log request" }).click();

        // It opens in the side panel.
        await expect(
            page.getByRole("heading", { name: "Acme NDA review" }),
        ).toBeVisible();

        // Assign it to the signed-in lawyer; the Unassign control confirms it.
        await page.getByRole("button", { name: "Assign to me" }).click();
        await expect(
            page.getByRole("button", { name: "Unassign" }),
        ).toBeVisible();

        // Move it to In progress.
        const statusSelect = page.getByRole("combobox", {
            name: "Change status",
        });
        await statusSelect.selectOption("in_progress");
        await expect(statusSelect).toHaveValue("in_progress");

        // Turn it into a matter and follow the link it leaves behind.
        await page.getByRole("button", { name: "Create matter" }).click();
        await expect(
            page.getByRole("link", { name: /Open matter/ }),
        ).toBeVisible();

        // The board itself must meet the accessibility baseline, in both themes.
        await expectAccessibleInEveryTheme(page, "/intake");
    });
});
