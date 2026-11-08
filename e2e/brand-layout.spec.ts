// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The start screen carries the brand, not the upstream name, and stays within
 * a narrow viewport however long the configured product name is.
 *
 * Real browser layout, synthetic API data: no account, backend or provider
 * key. The product name is compiled into the app, so the long-name case drives
 * the rendered wordmark to 40 characters in the page and checks the layout
 * holds — the InitialView wraps the name instead of overflowing, and
 * "Configure quick actions" is reachable without a hover.
 */
import { expect, test } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

async function mockAssistant(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        const json = (body: unknown) =>
            Promise.resolve(
                new Response(JSON.stringify(body), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        window.fetch = (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = new URL(url, location.href).pathname;
            if (!path.startsWith("/api/")) return originalFetch(input, init);
            if (path === "/api/auth/session")
                return json({ user: { id: "brand-user", email: "layout@example.com" } });
            if (path === "/api/user/profile")
                return json({
                    onboardingComplete: true,
                    displayName: "Layout test",
                    apiKeyStatus: {},
                    creditsRemaining: 100,
                });
            if (path === "/api/models/configured")
                return json({
                    models: [{ id: "test-model", label: "Test model", source: "Configured" }],
                });
            if (path.startsWith("/api/models/")) return json({ models: [] });
            // Every other list endpoint (chats, workspaces, workflows, …).
            return json([]);
        };
    });
}

test("the start screen shows the brand and no legacy name", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await mockAssistant(page);
    await page.goto("/assistant");

    const wordmark = page.locator('[data-slot="initial-view-wordmark"]');
    await expect(wordmark).toBeVisible();
    await expect(wordmark).not.toHaveText("");
    // The upstream name must not survive anywhere on the start screen.
    await expect(page.locator("body")).not.toContainText("Mike");
});

test("the start screen fits 360px with a 40-character name, Configure visible without hover", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await mockAssistant(page);
    await page.goto("/assistant");

    const wordmark = page.locator('[data-slot="initial-view-wordmark"]');
    await expect(wordmark).toBeVisible();

    // Drive the wordmark to a 40-character product name; the layout must wrap
    // it rather than force the page to scroll sideways.
    await wordmark.evaluate((element) => {
        element.textContent = "N".repeat(40);
    });

    const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, "no horizontal overflow at 360px").toBeLessThanOrEqual(1);

    const wordmarkOverflow = await wordmark.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
    );
    expect(wordmarkOverflow, "the wordmark wraps rather than clipping").toBeLessThanOrEqual(1);

    // No hover: the control is visible as soon as the screen renders.
    await expect(
        page.getByRole("button", { name: "Configure quick actions" }),
    ).toBeVisible();
});