// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "./fixtures";
import { E2E_WEB_ORIGIN, ensureOrganizationWorkspace } from "./users";
import { expectAccessibleInEveryTheme } from "./axe";

/**
 * The public request form, end to end: an org admin creates a form and gets
 * its link once; a visitor with no session opens the link, reads the
 * notices, submits a request and keeps the reference; the request shows up
 * on the organization's board; and both the public page and the forms page
 * pass the shared accessibility gate.
 */
test.describe("Public request form", () => {
    test("an anonymous submission reaches the board", async ({ page, browser }) => {
        test.setTimeout(120_000);

        const org = await ensureOrganizationWorkspace(page.request);

        // The admin creates a form through the API; the token is in the
        // answer this once.
        const created = await page.request.post("/api/intake/forms", {
            headers: { Origin: E2E_WEB_ORIGIN },
            data: {
                org_id: org.id,
                title: "Ask the legal team",
                intro: "Tell us what you need and by when.",
                retention_days: 180,
                privacy_policy_url: "https://example.com/privacy",
            },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const link = (await created.json()) as { token: string; path: string };
        expect(link.path).toBe(`/request/${link.token}`);

        // A visitor with no session opens the link.
        const visitorContext = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const visitor = await visitorContext.newPage();
        const title = `Supplier NDA review ${Date.now()}`;
        try {
            await visitor.goto(link.path);
            await expect(
                visitor.getByRole("heading", { level: 1, name: "Ask the legal team" }),
            ).toBeVisible({ timeout: 20_000 });
            await expect(
                visitor.locator("header").getByText(org.name, { exact: true }),
            ).toBeVisible();

            // The notices: the organization's disclaimer and privacy notice,
            // the product's line that no AI advice is shown, the retention.
            await expect(
                visitor.getByText(/does not create a lawyer-client relationship/),
            ).toBeVisible();
            await expect(visitor.getByText(/No AI-generated advice is shown/)).toBeVisible();
            await expect(visitor.getByText(/controls the personal data/)).toBeVisible();
            await expect(
                visitor.getByRole("link", { name: "Read the privacy policy" }),
            ).toHaveAttribute("href", "https://example.com/privacy");
            await expect(visitor.getByText(/deleted after 180 days/)).toBeVisible();

            // The footer every visitor is owed: Source, Terms, Privacy.
            const footer = visitor.getByRole("contentinfo");
            await expect(footer.getByRole("link", { name: "Source" })).toHaveAttribute(
                "href",
                /^https?:\/\//,
            );
            await expect(footer.getByRole("link", { name: "Terms" })).toBeVisible();
            await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();

            await expectAccessibleInEveryTheme(visitor, "/request");

            // The submit button is enabled before anything is typed: pressing
            // it is how a requester learns what is missing, not a dead button
            // that never says why.
            const send = visitor.getByRole("button", { name: "Send request" });
            await expect(send).toBeEnabled();

            // Submitting an empty form does not send it. A summary takes focus
            // and names what to correct; each empty field is marked invalid and
            // carries its own visible message.
            await send.click();
            const summary = visitor.locator('[data-slot="request-error-summary"]');
            await expect(summary).toBeVisible();
            await expect(summary).toBeFocused();
            await expect(summary.getByText("Your request was not sent")).toBeVisible();
            await expect(
                visitor.getByLabel("What is the request about?"),
            ).toHaveAttribute("aria-invalid", "true");
            await expect(
                visitor
                    .locator('[data-request-field="title"]')
                    .getByText("Add a short title for your request."),
            ).toBeVisible();
            // No horizontal scroll with the live form shown at a phone width.
            await visitor.setViewportSize({ width: 320, height: 844 });
            const overflow = await visitor.evaluate(
                () =>
                    document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow, "the request form overflows at 320px").toBeLessThanOrEqual(1);
            await visitor.setViewportSize({ width: 1280, height: 844 });

            await visitor.getByLabel("What is the request about?").fill(title);
            await visitor
                .getByLabel("Details")
                .fill("Please review the mutual NDA before we sign it next week.");
            await visitor.getByLabel("Your name").fill("Dana Client");
            await visitor.getByLabel("Your email address").fill("dana@example.com");
            await visitor.getByRole("button", { name: "Send request" }).click();

            // The receipt: a reference, the advice to keep it, the notices still there.
            await expect(
                visitor.getByRole("heading", { name: "Your request has been received" }),
            ).toBeVisible();
            await expect(visitor.getByText(/^REQ-\d+$/)).toBeVisible();
            await expect(visitor.getByText(/Keep this reference/)).toBeVisible();
            await expect(visitor.getByText(/No AI-generated advice is shown/)).toBeVisible();
        } finally {
            await visitorContext.close();
        }

        // An org member sees the request on the board.
        await page.goto("/assistant");
        await expect(page).toHaveURL(/\/assistant/, { timeout: 15_000 });
        await page.getByRole("button", { name: /^Account menu(?: —|$)/ }).click();
        await page.getByRole("menuitemradio", { name: org.name }).click();
        await page.goto("/intake");
        await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();
        await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });

        // The forms page lists the form and passes the gate too.
        await page.getByRole("link", { name: "Request forms" }).click();
        await expect(page).toHaveURL(/\/intake\/forms/);
        await expect(
            page.getByRole("article", { name: "Ask the legal team" }).first(),
        ).toBeVisible({ timeout: 20_000 });
        await expectAccessibleInEveryTheme(page, "/intake/forms");
    });

    test("an unknown link shows one notice and no form", async ({ browser }) => {
        const visitorContext = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const visitor = await visitorContext.newPage();
        try {
            await visitor.goto(`/request/${"A".repeat(43)}`);
            await expect(
                visitor.getByRole("heading", {
                    level: 1,
                    name: "This request form is not available",
                }),
            ).toBeVisible({ timeout: 20_000 });
            await expect(visitor.getByRole("button", { name: "Send request" })).toHaveCount(0);
        } finally {
            await visitorContext.close();
        }
    });
});
