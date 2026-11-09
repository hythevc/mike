// SPDX-License-Identifier: AGPL-3.0-only
/**
 * E2E tests for plans, seats and usage (W17).
 *
 * Test user: this worker's account (the storageState fixture in
 * e2e/fixtures.ts), who becomes the owner of any organization it creates.
 *
 * Plans are off by default on the stack (PLANS_ENABLED unset), so these tests
 * check the surfaces as a self-hoster sees them: the personal settings card no
 * longer shows a fixed "Free" tier, and an organization's owner sees a Plan and
 * usage tab that renders and passes the shared accessibility gate.
 *
 * Key source facts used by these selectors:
 *  - settings/page.tsx: PersonalPlanCard renders under the "Usage Plan"
 *    heading; with plans off it reads "AI use on your workspace is not limited
 *    by a plan." and never the word "Free".
 *  - OrganizationsOverview.tsx: button aria-label "New organization"; each org
 *    has a "Manage <name>" button.
 *  - OrganizationModals.tsx: name field #new-organization-name (placeholder
 *    "e.g. Elite Law LLP"); primary action "Create", then "Open organization".
 *  - OrganizationSettingsShell.tsx: owners and admins see a "Plan and usage"
 *    tab link; OrganizationPlanSettings renders a "Plan" heading.
 */
import { test, expect } from "./fixtures";
import { expectAccessible } from "./axe";

test.describe("plans, seats and usage", () => {
    test("the personal settings Usage Plan card no longer shows a fixed Free tier", async ({
        page,
    }) => {
        await page.goto("/settings");
        await expect(
            page.getByRole("heading", { name: "Settings" }),
        ).toBeVisible();
        const usagePlan = page.getByRole("heading", { name: "Usage Plan" });
        await expect(usagePlan).toBeVisible();

        // With plans off the card states the plan is not metered, rather than
        // the old vestigial "Free" tier.
        await expect(
            page.getByText("AI use on your workspace is not limited by a plan."),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/^Free$/)).toHaveCount(0);
    });

    test("an organization owner sees a Plan and usage tab that renders and is accessible", async ({
        page,
    }) => {
        const orgName = `Plan Test ${Date.now()}`;

        await page.goto("/organizations");
        await page.getByRole("button", { name: "New organization" }).click();
        await page.locator("#new-organization-name").fill(orgName);
        await page.getByRole("button", { name: "Create", exact: true }).click();
        // With no invitations, creation closes the modal immediately.
        // Back on the overview, manage the new organization.
        const manage = page.getByRole("button", { name: `Manage ${orgName}` });
        await expect(manage).toBeVisible({ timeout: 15_000 });
        await manage.click();
        await expect(page).toHaveURL(/\/organizations\/[^/]+\/settings/, {
            timeout: 15_000,
        });

        // The owner sees the tab, opens it, and the plan page renders.
        const planTab = page.getByRole("link", { name: "Plan and usage" });
        await expect(planTab).toBeVisible();
        await planTab.click();
        await expect(page).toHaveURL(/\/settings\/plan$/, { timeout: 15_000 });
        await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "AI usage this month" }),
        ).toBeVisible();

        await expectAccessible(page, {
            name: "/organizations/[id]/settings/plan",
            theme: "light",
        });
    });
});
