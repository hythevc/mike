// SPDX-License-Identifier: AGPL-3.0-only
//
// The legal content pages are public: they render the same signed out and
// mid-onboarding, and must pass the shared accessibility gate. /legal is a
// public route prefix, so the onboarding and MFA gates let it through without
// redirecting.
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./fixtures";
import { expectAccessibleInEveryTheme } from "./axe";
import { ensureUser } from "./users";

const TERMS_HEADING = "Terms of Service";
const DRAFT_BANNER = "Draft, not in effect, pending counsel review.";
const DISCLAIMER = /legal information, not legal advice/i;

async function expectTermsRendered(page: Page) {
    await expect(
        page.getByRole("heading", { level: 1, name: TERMS_HEADING }),
    ).toBeVisible();
    // A draft shows the banner, and every content page carries the disclaimer.
    await expect(page.getByText(DRAFT_BANNER)).toBeVisible();
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
}

test.describe("legal pages", () => {
    test.describe("signed out", () => {
        test.use({ storageState: { cookies: [], origins: [] } });

        test("renders /legal/terms and passes the axe check", async ({
            page,
        }) => {
            await page.goto("/legal/terms");
            await expectTermsRendered(page);
            await expectAccessibleInEveryTheme(page, "/legal/terms");
        });
    });

    test("renders /legal/terms mid-onboarding and passes the axe check", async ({
        page,
    }) => {
        test.setTimeout(90_000);
        const email = `e2e-legal-${randomUUID()}@example.com`;
        const password = "E2eLegal1!";
        await ensureUser(email, password);

        // A fresh account signs in and is held at the onboarding profile step
        // (its onboarding, including legal acceptance, is not complete).
        await page.goto("/login");
        await page.fill("#email", email);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/onboarding\/profile/, { timeout: 30_000 });

        // The public legal page still renders without leaving onboarding.
        await page.goto("/legal/terms");
        await expectTermsRendered(page);
        await expectAccessibleInEveryTheme(page, "/legal/terms");
    });
});
