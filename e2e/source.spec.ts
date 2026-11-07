// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public source page (AGPL-3.0 section 13). It must be reachable signed
 * out — the /source prefix is exempt from the onboarding and MFA gates (W03) —
 * and it must pass the shared accessibility gate in both themes, like /login.
 *
 * The page renders from the build's own identity and the brand configuration,
 * so it needs no session and no backend; these tests run with an empty
 * storage state.
 */
import { test, expect } from "./fixtures";
import { THEMES, expectAccessible } from "./axe";

test.describe("public /source page", () => {
    // Run with no stored session: the page must render for a signed-out visitor.
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const theme of THEMES) {
        test(`/source in ${theme}: no critical violations, serious within the ratchet`, async ({
            page,
        }) => {
            await page.goto("/source");
            await expect(page).toHaveURL(/\/source(?:[/?#]|$)/);
            await expect(
                page.getByRole("heading", { name: "Source code", level: 1 }),
            ).toBeVisible();

            await expectAccessible(page, { name: "/source", theme });
        });
    }

    test("offers the corresponding source at the running version", async ({
        page,
    }) => {
        await page.goto("/source");
        const sourceLink = page.getByRole("link", {
            name: "View the source at this version",
        });
        await expect(sourceLink).toBeVisible();
        // The link points at the repository; in a stamped build it carries the
        // running commit (<repository>/tree/<commit>).
        const href = await sourceLink.getAttribute("href");
        expect(href).toMatch(/^https?:\/\//);
        // The upstream attribution is shown.
        await expect(page.getByText(/Based on Mike/)).toBeVisible();
    });
});

test.describe("auth footer", () => {
    // The footer is mounted by login/layout.tsx and signup/layout.tsx, so it
    // appears on the signed-out auth pages.
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const path of ["/login", "/signup"]) {
        test(`${path} shows the source, terms and privacy footer`, async ({
            page,
        }) => {
            await page.goto(path);
            const footer = page.getByRole("contentinfo");
            const source = footer.getByRole("link", { name: "Source" });
            await expect(source).toBeVisible();
            // The Source link carries the running commit in a stamped build.
            const href = await source.getAttribute("href");
            expect(href).toMatch(/^https?:\/\//);
            await expect(
                footer.getByRole("link", { name: "Terms" }),
            ).toBeVisible();
            await expect(
                footer.getByRole("link", { name: "Privacy" }),
            ).toBeVisible();
        });
    }
});
