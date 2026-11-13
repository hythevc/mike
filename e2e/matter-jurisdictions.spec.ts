// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The matter jurisdiction profile in a real browser: a project's Details
 * form with jurisdictions chosen, the chips under the project header, and an
 * organization's New Project Defaults, each through the shared accessibility
 * gate in both themes, then cleared again.
 *
 * The profile is off unless a deployment turns on both switches:
 * MATTER_JURISDICTIONS_ENABLED for the API and the build-time
 * NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED for the web app.
 * playwright.config.ts and the e2e workflow both start the stack with them on
 * and say so through E2E_MATTER_JURISDICTIONS_ENABLED, so these tests expect
 * the fields and fail if they are missing. Only a run that does not declare
 * the profile on (E2E_MATTER_JURISDICTIONS_ENABLED unset or not "true")
 * skips them: there is then nothing to scan.
 */
import { test, expect, type Page } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";
import { createProject } from "./helpers";
import { ensureOrganizationWorkspace } from "./users";

const SKIP_REASON =
    "E2E_MATTER_JURISDICTIONS_ENABLED is not 'true': the stack under test was not started with the matter jurisdiction profile on";

/** Opens a project's Details from its row menu on the projects list. */
async function openProjectDetails(page: Page, projectName: string) {
    await page.goto("/projects");
    const row = page.locator("main div.group").filter({ hasText: projectName });
    await expect(row.first()).toBeVisible({ timeout: 12_000 });
    await row.locator("button").filter({ hasText: "···" }).click();
    await page
        .getByRole("menuitem", { name: "Edit details", exact: true })
        .click();
    await expect(page.locator("#project-details-name")).toBeVisible();
}

/** The jurisdictions the server has stored for the project at `projectPath`. */
async function storedJurisdictions(
    page: Page,
    projectPath: string,
): Promise<unknown> {
    const res = await page.request.get(`/api${projectPath}`);
    expect(res.ok(), `GET /api${projectPath}`).toBe(true);
    return ((await res.json()) as { jurisdictions?: unknown }).jurisdictions;
}

/** Ticks jurisdictions in an open multi-select menu, then closes the menu. */
async function chooseJurisdictions(page: Page, names: string[]) {
    for (const name of names)
        await page.getByRole("menuitemcheckbox", { name }).click();
    // Escape closes the menu, not the dialog or page around it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
}

test.describe("matter jurisdiction profile", () => {
    test.beforeEach(() => {
        test.skip(
            process.env.E2E_MATTER_JURISDICTIONS_ENABLED !== "true",
            SKIP_REASON,
        );
    });

    test("a project's jurisdictions are chosen in Details, shown under its header and cleared", async ({
        page,
    }) => {
        test.setTimeout(90_000);
        const projectName = `E2E Jurisdictions ${Date.now()}`;
        await createProject(page, projectName);
        const projectPath = new URL(page.url()).pathname;

        await openProjectDetails(page, projectName);
        const jurisdictions = page.getByLabel("Jurisdictions", { exact: true });
        // Usable once the registry has loaded.
        await expect(jurisdictions).toBeEnabled();
        await expect(
            page.getByText(
                "No jurisdictions chosen. Choose the ones this project's work is about.",
            ),
        ).toBeVisible();
        await jurisdictions.click();
        await chooseJurisdictions(page, ["Portugal PT", "European Union EU"]);
        await expect(
            page.getByRole("button", { name: "Remove Portugal" }),
        ).toBeVisible();
        await expect(page.getByText("2 of 10 chosen")).toBeVisible();

        // The form with the fields filled in, as a person sees it.
        await expectAccessibleInEveryTheme(page, "/projects (project details)");

        await page.getByRole("button", { name: "Update", exact: true }).click();
        await expect(page.getByText("Updated", { exact: true })).toBeVisible();
        expect(await storedJurisdictions(page, projectPath)).toEqual([
            "PT",
            "EU",
        ]);

        // The chips under the project header, on the project's own page.
        await page.goto(projectPath);
        const chips = page.getByRole("list", {
            name: "Jurisdictions of this project",
        });
        await expect(chips.getByRole("listitem")).toHaveText([
            "Portugal",
            "European Union",
        ]);
        await expectAccessibleInEveryTheme(page, "/projects/[id]");

        // Cleared again: the empty state, and no chips.
        await openProjectDetails(page, projectName);
        await expect(
            page.getByRole("button", { name: "Remove Portugal" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Clear all" }).click();
        await expect(
            page.getByText(
                "No jurisdictions chosen. Choose the ones this project's work is about.",
            ),
        ).toBeVisible();
        await page.getByRole("button", { name: "Update", exact: true }).click();
        await expect(page.getByText("Updated", { exact: true })).toBeVisible();
        expect(await storedJurisdictions(page, projectPath)).toEqual([]);
        await page.goto(projectPath);
        // The header names the project once it has loaded; the chips would
        // be drawn beneath it by then.
        await expect(page.getByTitle("Back to project documents")).toBeVisible();
        await expect(
            page.getByRole("list", { name: "Jurisdictions of this project" }),
        ).toHaveCount(0);
    });

    test("an organization's default jurisdictions are chosen, saved and cleared", async ({
        page,
    }) => {
        test.setTimeout(60_000);
        // Its own organization, so no other spec's projects start with these.
        const org = await ensureOrganizationWorkspace(
            page.request,
            "Jurisdictions E2E Firm",
        );
        await page.goto(`/organizations/${org.id}/settings`);

        const section = page.getByRole("region", {
            name: "New Project Defaults",
        });
        await expect(section).toBeVisible({ timeout: 15_000 });
        const defaults = section.getByLabel("Default jurisdictions", {
            exact: true,
        });
        await expect(defaults).toBeEnabled();
        const save = section.getByRole("button", { name: "Save defaults" });
        const clearAll = section.getByRole("button", { name: "Clear all" });
        const empty = section.getByText(
            "No default jurisdictions. New projects start with none.",
        );

        // Start from none, whatever an earlier attempt left behind.
        if (await clearAll.isVisible()) {
            await clearAll.click();
            await save.click();
            await expect(empty).toBeVisible();
        }

        await defaults.click();
        await chooseJurisdictions(page, ["Ireland IE"]);
        await expect(
            section.getByRole("button", { name: "Remove Ireland" }),
        ).toBeVisible();
        await save.click();
        await expect(section.getByText("Saved", { exact: true })).toBeVisible();

        await expectAccessibleInEveryTheme(
            page,
            "/organizations/[id]/settings",
        );

        // Cleared again, so the organization is left as it was found.
        await clearAll.click();
        await expect(empty).toBeVisible();
        await save.click();
        await expect(section.getByText("Saved", { exact: true })).toBeVisible();
        await page.reload();
        await expect(
            page
                .getByRole("region", { name: "New Project Defaults" })
                .getByText(
                    "No default jurisdictions. New projects start with none.",
                ),
        ).toBeVisible({ timeout: 15_000 });
    });
});
