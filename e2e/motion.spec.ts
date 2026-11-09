/**
 * Motion (W26). The shared motion tokens migrate the chrome to transform- and
 * opacity-only interactions. These checks prove the two properties that matter
 * in a real browser:
 *
 *  - Opening the sidebar, the account menu and a row ··· menu shifts no layout
 *    (a `layout-shift` PerformanceObserver records zero cumulative shift for
 *    entries without recent input — motion that moved layout would register).
 *  - Under `prefers-reduced-motion: reduce`, the account menu starts no
 *    animation whose keyframes change `transform`, and it is visible at once.
 *
 * Auth: the storageState fixture signs this worker in; see e2e/fixtures.ts.
 */
import { test, expect, type Page } from "./fixtures";
import { createProject } from "./helpers";

/** Accumulate layout shift (excluding shifts within 500ms of an input) on the
 *  window, from before first paint, surviving each navigation. */
function installLayoutShiftObserver(page: Page) {
    return page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const shift = entry as PerformanceEntry & {
                        value: number;
                        hadRecentInput: boolean;
                    };
                    if (!shift.hadRecentInput) {
                        (window as unknown as { __cls: number }).__cls +=
                            shift.value;
                    }
                }
            });
            observer.observe({ type: "layout-shift", buffered: true });
        } catch {
            // layout-shift is Chromium-only; the suite runs there.
        }
    });
}

const readShift = (page: Page) =>
    page.evaluate(() => (window as unknown as { __cls: number }).__cls);
const resetShift = (page: Page) =>
    page.evaluate(() => {
        (window as unknown as { __cls: number }).__cls = 0;
    });

/** Let the layout-shift observer flush its frame callbacks before reading. */
async function settle(page: Page) {
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );
    await page.waitForTimeout(150);
}

test.describe("motion", () => {
    test("opening the sidebar and account menu shifts no layout", async ({
        page,
    }) => {
        await installLayoutShiftObserver(page);
        await page.goto("/assistant");
        await expect(page.locator("h1, h2").first()).toBeVisible();
        await settle(page);
        await resetShift(page);

        // Collapse, then expand the sidebar (its width is the one allowed
        // size transition; it must not shift layout without recent input).
        await page.getByRole("button", { name: "Close sidebar" }).click();
        await expect(
            page.getByRole("button", { name: "Open sidebar" }),
        ).toBeVisible();
        await page.waitForTimeout(400);
        await page.getByRole("button", { name: "Open sidebar" }).click();
        await expect(
            page.getByRole("button", { name: "Close sidebar" }),
        ).toBeVisible();
        await page.waitForTimeout(400);

        // The account menu is a portalled overlay; it must not nudge the page.
        await page.getByRole("button", { name: "Account menu" }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await settle(page);

        expect(await readShift(page)).toBe(0);
    });

    test("opening a row ··· menu shifts no layout", async ({ page }) => {
        await installLayoutShiftObserver(page);
        // A row menu needs a row; create one, then view the list.
        await createProject(page, `Motion ${Date.now()}`);
        await page.goto("/projects");
        const rowMenu = page
            .getByRole("button", { name: "Open row actions" })
            .first();
        await expect(rowMenu).toBeVisible();
        await settle(page);
        await resetShift(page);

        await rowMenu.click();
        await expect(page.getByRole("menu")).toBeVisible();
        await settle(page);

        expect(await readShift(page)).toBe(0);
    });

    test("reduced motion: the account menu does not animate transform", async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/assistant");
        const trigger = page.getByRole("button", { name: "Account menu" });
        await expect(trigger).toBeVisible();
        await trigger.click();

        const menu = page.getByRole("menu");
        // Visible at once — not gated on an entrance finishing.
        await expect(menu).toBeVisible();

        // No running animation on the surface (or its children) changes
        // transform: reduced motion leaves only the opacity fade.
        const animatesTransform = await menu.evaluate((root) => {
            const identity = (value: string | undefined) =>
                !value ||
                value === "none" ||
                value === "matrix(1, 0, 0, 1, 0, 0)" ||
                /^matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\)$/.test(
                    value,
                );
            const nodes = [root, ...root.querySelectorAll("*")];
            for (const node of nodes) {
                for (const animation of node.getAnimations()) {
                    const effect = animation.effect;
                    const frames =
                        effect && "getKeyframes" in effect
                            ? (effect.getKeyframes() as Array<
                                  Record<string, string | undefined>
                              >)
                            : [];
                    for (const frame of frames) {
                        if (!identity(frame.transform)) return true;
                        if (frame.translate && frame.translate !== "none") return true;
                        if (
                            frame.scale &&
                            frame.scale !== "none" &&
                            frame.scale !== "1"
                        ) {
                            return true;
                        }
                    }
                }
            }
            return false;
        });
        expect(animatesTransform).toBe(false);
    });
});
