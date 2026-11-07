// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The open-source notices page (/workflows/attributions). After the e2e
 * catalog sync (`npm run sync:workflows`, run in CI setup before the suite),
 * the active catalog holds the built-in and add-on workflows, so the page
 * lists them with the author, the licence and a source link. The page then
 * goes through the shared accessibility gate in both themes.
 *
 * Auth: runs signed in as this worker's account (the storageState fixture in
 * e2e/fixtures.ts).
 */
import { test, expect } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";

test.describe("Workflow open-source notices", () => {
  test("lists the synced catalog workflows with their licences and passes the a11y gate", async ({
    page,
  }) => {
    await page.goto("/workflows/attributions");

    await expect(
      page.getByRole("heading", { name: "Open-source notices" }),
    ).toBeVisible();

    // The catalog sync installs workflows, so the page lists them rather than
    // showing the empty state or failing to load.
    await expect(
      page.getByText("The open-source notices could not be loaded."),
    ).toHaveCount(0);
    const entries = page.getByRole("listitem");
    await expect(entries.first()).toBeVisible();
    expect(await entries.count()).toBeGreaterThan(0);

    // Every listed workflow carries a Licence field (an SPDX link, or
    // "Licence not recorded" when the catalog has none yet).
    await expect(page.getByText("Licence", { exact: true }).first()).toBeVisible();

    await expectAccessibleInEveryTheme(page, "/workflows/attributions");
  });

  test("links back to the workflows list from the notices breadcrumb", async ({
    page,
  }) => {
    await page.goto("/workflows/attributions");
    await page.getByRole("button", { name: "Workflows" }).first().click();
    await expect(page).toHaveURL(/\/workflows(\?.*)?$/);
  });
});
