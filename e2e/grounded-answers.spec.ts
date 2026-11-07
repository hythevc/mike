/**
 * Grounded answers E2E (W25), on the deterministic provider fixture:
 *   1. A documents-only turn whose answer is "Not in these documents." renders
 *      that sentence and carries the not-legal-advice disclaimer.
 *   2. A quote that really sits on page 2 but is cited to page 1 is corrected
 *      to the found page, so its citation shows the other-page status.
 * Both pages pass the shared axe gate.
 *
 * Auth: signed in as this worker's account (the storageState fixture).
 */
import path from "path";
import { test, expect } from "./fixtures";
import { hasLlmKey, LLM_SKIP_REASON } from "./llm";
import {
    createProject,
    PDF_FIXTURE,
    selectClaudeModel,
    expectSavedAnswer,
} from "./helpers";
import { expectAccessible } from "./axe";

const TWO_PAGE_FIXTURE = path.join(__dirname, "fixtures/two-page.pdf");

test("documents-only answer renders 'Not in these documents' with the disclaimer", async ({
    page,
}) => {
    test.skip(!hasLlmKey, LLM_SKIP_REASON);
    test.setTimeout(120_000);
    await createProject(page, `E2E documents-only ${Date.now()}`, PDF_FIXTURE);
    await page.goto(`${page.url().split("?")[0]}/assistant`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/assistant\/chat$/, {
        timeout: 30_000,
    });
    await selectClaudeModel(page);
    // A project chat has documents in scope, so the toggle is offered.
    await page.getByRole("button", { name: "Documents only" }).click();
    const input = page.getByPlaceholder("How can I help?");
    await input.fill("Is there an arbitration clause?");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[^/]+\/assistant\/chat\/[^/]+$/);

    await expect(page.getByText("Not in these documents.")).toBeVisible({
        timeout: 60_000,
    });
    await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
    ).toBeHidden({ timeout: 60_000 });
    await expect(
        page.getByText(/Legal information, not legal advice/),
    ).toBeVisible();

    await expectAccessible(page, { name: "/assistant", theme: "light" });
});

test("a quote cited to the wrong page is corrected to the page it was found on", async ({
    page,
}) => {
    test.skip(!hasLlmKey, LLM_SKIP_REASON);
    test.setTimeout(120_000);
    await createProject(page, `E2E wrong-page ${Date.now()}`, TWO_PAGE_FIXTURE);
    await page.goto(`${page.url().split("?")[0]}/assistant`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/assistant\/chat$/, {
        timeout: 30_000,
    });
    await selectClaudeModel(page);
    const input = page.getByPlaceholder("How can I help?");
    await input.fill("Quote the second-page clause.");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[^/]+\/assistant\/chat\/[^/]+$/);

    await expectSavedAnswer(page, "The clause is quoted below");
    // The quote is really on page 2; the server moved its target there, so the
    // citation's status reports the correction rather than its cited page 1.
    const pill = page.getByRole("button", { name: "Citation 1" });
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await expect(pill).toHaveAttribute(
        "title",
        /Quote is on p\. 2, not p\. 1/,
    );

    await expectAccessible(page, { name: "/assistant", theme: "light" });
});
