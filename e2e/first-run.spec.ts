// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run activation E2E: a brand-new account signs up, finishes onboarding,
 * reaches the ready sample matter from the get-started checklist, and gets a
 * first answer whose citation is matched to the source and marked found.
 *
 * Runs on the deterministic Anthropic-protocol fixture (e2e/anthropic-stub.mjs)
 * in CI; locally it needs that fixture or a live key. The browser flow and the
 * axe gate run on the merged full stack; the Docker daemon is not available in
 * the item worktree.
 */
import { test, expect } from "./fixtures";
import { completeOnboardingIfRequired } from "./onboarding";
import { ensureUser } from "./users";
import { expectAccessibleInEveryTheme, setTheme } from "./axe";
import { createProject, PDF_FIXTURE, expectSavedAnswer } from "./helpers";
import { hasLlmKey, LLM_SKIP_REASON } from "./llm";

// Onboarding happens once per account, so this spec cannot reuse the per-worker
// signed-in session; it bootstraps and signs in its own first-run user.
const FIRST_RUN_EMAIL = process.env.E2E_FIRST_RUN_EMAIL ?? "e2e-first-run@mike.local";
const FIRST_RUN_PASSWORD = process.env.E2E_FIRST_RUN_PASSWORD ?? "E2eFirstRun1!";

test.describe("first-run activation", () => {
    // Start signed out; this spec drives sign-in itself.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("new user reaches the sample matter and a quote marked found", async ({
        page,
    }) => {
        test.skip(!hasLlmKey, LLM_SKIP_REASON);
        test.setTimeout(180_000);

        await ensureUser(FIRST_RUN_EMAIL, FIRST_RUN_PASSWORD);
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);
        await page.fill("#email", FIRST_RUN_EMAIL);
        await page.fill("#password", FIRST_RUN_PASSWORD);
        await page.click('button[type="submit"]');
        await completeOnboardingIfRequired(page);
        await expect(page).toHaveURL(/\/assistant/);

        // The get-started checklist is on the empty assistant home.
        const checklist = page.getByRole("region", { name: "Get started" });
        await expect(checklist).toBeVisible({ timeout: 15_000 });

        // The shared accessibility gate, light and dark, with the checklist up.
        await expectAccessibleInEveryTheme(page, "/assistant");
        await setTheme(page, "light");

        // Open the ready sample matter built from unmodified public templates.
        await checklist
            .getByRole("button", { name: "Try a sample matter" })
            .click();
        await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 60_000 });
        await expect(
            page.getByText("Sample matter - public templates, not client data"),
        ).toBeVisible({ timeout: 30_000 });

        // A first answer whose citation is matched to the source and marked
        // found. test.pdf is attached through the proven project-upload path:
        // the sample matter itself holds templates, and the citation script
        // keys on the one-page fixture.
        await createProject(page, `First-run cite ${Date.now()}`, PDF_FIXTURE);
        await page.goto(`${page.url().split("?")[0]}/assistant`);
        await page.getByRole("button", { name: "Create", exact: true }).click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/assistant\/chat$/, {
            timeout: 30_000,
        });

        // Value before setup: the composer opens on a usable model by default,
        // with no manual selection (W14's product default).
        await expect(
            page.getByRole("button", { name: "Choose model", exact: true }),
        ).toHaveAttribute("title", /Choose model — .+/, { timeout: 15_000 });

        const input = page.getByPlaceholder("How can I help?");
        await input.fill("Quote the first line of test.pdf with a citation.");
        await input.press("Enter");
        await expect(page).toHaveURL(
            /\/projects\/[^/]+\/assistant\/chat\/[^/]+$/,
        );

        // The answer quotes the PDF's first line and carries a citation that
        // the app matched to the source — a verified marker, with no
        // "could not verify" badge.
        await expectSavedAnswer(page, "Test PDF Document");
        await expect(page.locator('[aria-label="Citation 1"]')).toBeVisible();
        await expect(page.getByText("Could not verify quote")).toHaveCount(0);
    });
});
