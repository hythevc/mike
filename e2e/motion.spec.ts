// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Motion. The chrome moves on transform and opacity only, on shared tokens.
 * Class-name unit tests cannot tell whether the browser really animates what
 * they name, so these checks ask the browser:
 *
 *  - Toggling the sidebar leaves no layout shift behind once its width has
 *    settled, and opening the account menu or a row ··· menu shifts nothing
 *    at all.
 *  - The account menu enters over at most 2px at no less than 0.98 scale, and
 *    leaves quicker than it came.
 *  - A pressed pill eases: the browser starts a transition on `scale`.
 *  - Under `prefers-reduced-motion: reduce` the account menu is on screen in
 *    the first frame after the press that opens it, its entrance changes
 *    opacity and nothing else, and no animation the press starts moves, turns
 *    or resizes anything.
 *
 * The page records its own motion from before first paint (see
 * `installMotionRecorder`), so an assertion never depends on how soon after
 * an interaction the test gets to look.
 *
 * Auth: the storageState fixture signs this worker in; see e2e/fixtures.ts.
 */
import { waitForSettledPage } from "./axe";
import { test, expect, type Page } from "./fixtures";
import { createProject } from "./helpers";

/** What a CSS animation's keyframes change, worked out in the page. */
interface AnimationRecord {
    /** The `@keyframes` name: tw-animate's are `enter` and `exit`. */
    name: string;
    /** The animated element's ARIA role, to tell a menu from anything else. */
    role: string | null;
    durationMs: number;
    /** The farthest a keyframe sits from the element's resting place, in px. */
    travelPx: number;
    /** The smallest scale a keyframe holds; 1 when it never scales. */
    smallestScale: number;
    /**
     * Whether every keyframe leaves the element exactly where it rests: each
     * one's transform is the identity matrix, so nothing travels, scales,
     * turns or skews.
     */
    still: boolean;
    /** Whether opacity differs between keyframes. */
    fades: boolean;
    /** Properties other than transform and opacity that differ between keyframes. */
    others: string[];
    /** The raw keyframes, for a failure message. */
    frames: Array<Record<string, string>>;
}

interface MotionLog {
    /** Every `layout-shift` entry, with whether it followed input within 500ms. */
    shifts: Array<{ value: number; hadRecentInput: boolean }>;
    /** Every CSS animation that started. */
    animations: AnimationRecord[];
    /** Every CSS transition that started: its property, and the element's
     *  ARIA role and `data-motion-probe` to tell which element it ran on. */
    transitions: Array<{
        property: string;
        role: string | null;
        probe: string | null;
    }>;
    /** For every pointer press: whether a menu was on screen in the first
     *  animation frame after it. */
    presses: Array<{ menuOnScreen: boolean }>;
}

type MotionWindow = Window & { __motion: MotionLog };

/**
 * Record layout shifts, animation starts and transition starts on `window`,
 * from before first paint. Events are recorded as they happen, so a check
 * cannot pass because it looked after an animation had already finished.
 */
function installMotionRecorder(page: Page) {
    return page.addInitScript(() => {
        const log: MotionLog = {
            shifts: [],
            animations: [],
            transitions: [],
            presses: [],
        };
        (window as unknown as MotionWindow).__motion = log;

        try {
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const shift = entry as PerformanceEntry & {
                        value: number;
                        hadRecentInput: boolean;
                    };
                    log.shifts.push({
                        value: shift.value,
                        hadRecentInput: shift.hadRecentInput,
                    });
                }
            }).observe({ type: "layout-shift", buffered: true });
        } catch {
            // `layout-shift` entries are Chromium-only, and so is this suite.
        }

        /** A keyframe's transform as one matrix; null when it cannot be read. */
        const matrixOf = (frame: Record<string, string>) => {
            const parts: string[] = [];
            if (frame.translate && frame.translate !== "none") {
                parts.push(`translate(${frame.translate.split(/\s+/).slice(0, 2).join(", ")})`);
            }
            if (frame.rotate && frame.rotate !== "none") {
                parts.push(`rotate(${frame.rotate})`);
            }
            if (frame.scale && frame.scale !== "none") {
                parts.push(`scale(${frame.scale.split(/\s+/).slice(0, 2).join(", ")})`);
            }
            if (frame.transform && frame.transform !== "none") {
                parts.push(frame.transform);
            }
            try {
                return new DOMMatrixReadOnly(parts.join(" "));
            } catch {
                // A length the matrix cannot resolve (a percentage, say).
                return null;
            }
        };

        document.addEventListener(
            "animationstart",
            (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                for (const animation of target.getAnimations()) {
                    const effect = animation.effect;
                    if (
                        !(animation instanceof CSSAnimation) ||
                        animation.animationName !== event.animationName ||
                        !(effect instanceof KeyframeEffect)
                    ) {
                        continue;
                    }
                    const frames = effect.getKeyframes().map((keyframe) => {
                        const values: Record<string, string> = {};
                        for (const [property, value] of Object.entries(keyframe)) {
                            if (
                                property === "offset" ||
                                property === "computedOffset" ||
                                property === "easing" ||
                                property === "composite"
                            ) {
                                continue;
                            }
                            values[property] = String(value);
                        }
                        return values;
                    });

                    let travelPx = 0;
                    let smallestScale = 1;
                    let still = true;
                    for (const frame of frames) {
                        const matrix = matrixOf(frame);
                        if (!matrix) {
                            // Unreadable counts as movement, never as stillness.
                            travelPx = Number.POSITIVE_INFINITY;
                            still = false;
                            continue;
                        }
                        // Decided on the numbers, not on how the browser
                        // spells the value: `translate3d(0px, 0px, 0px)
                        // scale3d(1, 1, 1) rotate(0deg)` is the identity.
                        if (!matrix.isIdentity) still = false;
                        travelPx = Math.max(travelPx, Math.hypot(matrix.m41, matrix.m42));
                        smallestScale = Math.min(
                            smallestScale,
                            Math.hypot(matrix.m11, matrix.m12),
                            Math.hypot(matrix.m21, matrix.m22),
                        );
                    }

                    const transformProperties = ["transform", "translate", "scale", "rotate"];
                    const differs = (property: string) =>
                        new Set(
                            frames.map((frame) => {
                                const value = frame[property] ?? "";
                                // tw-animate always writes `filter: blur(0px)`
                                // on one side; that is no filter at all.
                                return property === "filter" && value === "blur(0px)"
                                    ? "none"
                                    : value;
                            }),
                        ).size > 1;
                    const properties = new Set(frames.flatMap((frame) => Object.keys(frame)));

                    const duration = effect.getTiming().duration;
                    log.animations.push({
                        name: event.animationName,
                        role: target.getAttribute("role"),
                        durationMs: typeof duration === "number" ? duration : Number.NaN,
                        travelPx,
                        smallestScale,
                        still,
                        fades: differs("opacity"),
                        others: [...properties].filter(
                            (property) =>
                                property !== "opacity" &&
                                !transformProperties.includes(property) &&
                                differs(property),
                        ),
                        frames,
                    });
                }
            },
            true,
        );

        document.addEventListener(
            "transitionrun",
            (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                log.transitions.push({
                    property: event.propertyName,
                    role: target.getAttribute("role"),
                    probe: target.getAttribute("data-motion-probe"),
                });
            },
            true,
        );

        // In the first frame after every press the page looks once for a menu
        // and writes down whether it is on screen. A test reads the note, so
        // "within one frame" is measured here and never by how quickly the
        // test manages to look.
        document.addEventListener(
            "pointerdown",
            () => {
                requestAnimationFrame(() => {
                    const menu = document.querySelector('[role="menu"]');
                    const box = menu?.getBoundingClientRect();
                    log.presses.push({
                        menuOnScreen:
                            menu !== null &&
                            box !== undefined &&
                            box.width > 0 &&
                            box.height > 0 &&
                            getComputedStyle(menu).visibility === "visible",
                    });
                });
            },
            true,
        );
    });
}

const readMotion = (page: Page) =>
    page.evaluate(() => (window as unknown as MotionWindow).__motion);

/** Forget what was recorded so far: loading the page is not under test. */
const resetMotion = (page: Page) =>
    page.evaluate(() => {
        const log = (window as unknown as MotionWindow).__motion;
        log.shifts.length = 0;
        log.animations.length = 0;
        log.transitions.length = 0;
        log.presses.length = 0;
    });

const menuAnimations = async (page: Page, name: "enter" | "exit") =>
    (await readMotion(page)).animations.filter(
        (animation) => animation.role === "menu" && animation.name === name,
    );

/**
 * Long enough for the sidebar's 300ms width change to end and for the 500ms
 * in which the browser still attributes a shift to the click to run out, so
 * anything that moves after the transition is counted.
 */
const SIDEBAR_SETTLE_MS = 700;
/** Longer than a menu's entrance, so a late nudge is on record before reading. */
const MENU_SETTLE_MS = 400;
/** Room for a keyframe value that went through a float on its way back. */
const ROUNDING = 1e-4;

/**
 * Wait until the page and the sidebar have stopped loading, then forget what
 * was recorded. A row that arrives late moves the list beneath it, and that
 * is loading, not motion; it must not land inside a measurement.
 */
async function startMeasuring(page: Page) {
    await waitForSettledPage(page);
    await expect
        .poll(
            () =>
                page
                    .locator(
                        '[id^="sidebar-"] .animate-pulse, [data-slot="sidebar-heading-loading"]',
                    )
                    .count(),
            { message: "the sidebar is still loading", timeout: 20_000 },
        )
        .toBe(0);
    await page.waitForTimeout(SIDEBAR_SETTLE_MS);
    await resetMotion(page);
}

test.describe("motion", () => {
    test("toggling the sidebar leaves no layout shift behind", async ({ page }) => {
        await installMotionRecorder(page);
        await page.goto("/assistant");
        const close = page.getByRole("button", { name: "Close sidebar" });
        const open = page.getByRole("button", { name: "Open sidebar" });
        await expect(close).toBeVisible();
        await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
        await startMeasuring(page);

        // The sidebar's width is the one size that animates, so the page
        // beside it does move while the click is fresh. What must not happen
        // is a shift the click does not explain: one that arrives after the
        // width has settled.
        await close.click();
        await expect(open).toBeVisible();
        await page.waitForTimeout(SIDEBAR_SETTLE_MS);
        await open.click();
        await expect(close).toBeVisible();
        await page.waitForTimeout(SIDEBAR_SETTLE_MS);

        const unexplained = (await readMotion(page)).shifts.filter(
            (shift) => !shift.hadRecentInput,
        );
        expect(unexplained).toEqual([]);
    });

    test("the account menu opens and closes without moving the page", async ({
        page,
    }) => {
        await installMotionRecorder(page);
        await page.goto("/assistant");
        const trigger = page.getByRole("button", { name: "Account menu" });
        await expect(trigger).toBeVisible();
        await startMeasuring(page);

        await trigger.click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await expect
            .poll(async () => (await menuAnimations(page, "enter")).length)
            .toBeGreaterThan(0);
        await page.waitForTimeout(MENU_SETTLE_MS);

        // The menu is a portalled overlay: nothing on the page may move for
        // it, whether or not a click came first.
        expect((await readMotion(page)).shifts).toEqual([]);

        // It grows out of its trigger: a fade, a short travel, a slight scale.
        const entrances = await menuAnimations(page, "enter");
        for (const enter of entrances) {
            const keyframes = JSON.stringify(enter.frames);
            expect(enter.fades, keyframes).toBe(true);
            expect(enter.travelPx, keyframes).toBeGreaterThan(0);
            expect(enter.travelPx, keyframes).toBeLessThanOrEqual(2 + ROUNDING);
            expect(enter.smallestScale, keyframes).toBeLessThan(1);
            expect(enter.smallestScale, keyframes).toBeGreaterThanOrEqual(
                0.98 - ROUNDING,
            );
            expect(enter.others, keyframes).toEqual([]);
        }

        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await page.waitForTimeout(MENU_SETTLE_MS);

        // The dismissal is quicker than the entrance, and moves nothing either.
        const exits = await menuAnimations(page, "exit");
        expect(exits.length).toBeGreaterThan(0);
        for (const exit of exits) {
            expect(exit.durationMs).toBeGreaterThan(0);
            expect(exit.durationMs).toBeLessThan(entrances[0].durationMs);
            expect(exit.others, JSON.stringify(exit.frames)).toEqual([]);
        }
        const log = await readMotion(page);
        expect(log.shifts).toEqual([]);

        // The surface moves by its keyframes alone. A transition on it would
        // mean something else is animating as Radix places and sizes the
        // menu: its available height, for one.
        expect(
            log.transitions.filter((transition) => transition.role === "menu"),
        ).toEqual([]);
    });

    test("a row ··· menu opens without moving the page", async ({ page }) => {
        await installMotionRecorder(page);
        // A row menu needs a row; create one, then view the list.
        await createProject(page, `Motion ${Date.now()}`);
        await page.goto("/projects");
        const rowMenu = page
            .getByRole("button", { name: "Open row actions" })
            .first();
        await expect(rowMenu).toBeVisible();
        await startMeasuring(page);

        await rowMenu.click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expect
            .poll(async () => (await menuAnimations(page, "enter")).length)
            .toBeGreaterThan(0);
        await page.waitForTimeout(MENU_SETTLE_MS);

        expect((await readMotion(page)).shifts).toEqual([]);
    });

    test("a pressed pill eases its scale", async ({ page }) => {
        await installMotionRecorder(page);
        await page.goto("/projects");
        // The active filter: pressing it again changes nothing on the page.
        const pill = page
            .locator('[data-slot="tab-pill-button"][aria-pressed="true"]')
            .first();
        await expect(pill).toBeVisible();
        // The page has finished loading, so the pill that gets marked is the
        // one that stays.
        await waitForSettledPage(page);
        await pill.evaluate((element) =>
            element.setAttribute("data-motion-probe", "pill"),
        );
        const box = await pill.boundingBox();
        if (!box) throw new Error("The filter pill has no box to press.");
        await resetMotion(page);

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        try {
            // The press is a transition on `scale`, not a jump: Tailwind
            // writes `scale-*` as the `scale` property, and the pill's
            // property list has to name that property for it to ease.
            await expect
                .poll(async () =>
                    (await readMotion(page)).transitions
                        .filter((transition) => transition.probe === "pill")
                        .map((transition) => transition.property),
                )
                .toContain("scale");
            await expect
                .poll(() => pill.evaluate((element) => getComputedStyle(element).scale))
                .toBe("0.98");
        } finally {
            await page.mouse.up();
        }
    });

    test("reduced motion: the account menu appears at once and only fades", async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await installMotionRecorder(page);
        await page.goto("/assistant");
        const trigger = page.getByRole("button", { name: "Account menu" });
        await expect(trigger).toBeVisible();
        await resetMotion(page);

        await trigger.click();

        // The menu is on screen in the first frame after the press, not held
        // back until an entrance has finished. The page looked once, in that
        // frame, and wrote down what it saw; the wait here is for the note to
        // arrive, not for the menu.
        await expect
            .poll(async () => (await readMotion(page)).presses.length)
            .toBeGreaterThan(0);
        expect((await readMotion(page)).presses[0]).toEqual({
            menuOnScreen: true,
        });

        // Its entrance ran, and changed opacity and nothing else: gentler,
        // not frozen. Recorded when it started, so this cannot pass by
        // looking after the fade is over.
        await expect
            .poll(async () => (await menuAnimations(page, "enter")).length)
            .toBeGreaterThan(0);
        for (const enter of await menuAnimations(page, "enter")) {
            const keyframes = JSON.stringify(enter.frames);
            expect(enter.fades, keyframes).toBe(true);
            expect(enter.others, keyframes).toEqual([]);
        }

        // And nothing the press started moves, turns or resizes anything:
        // every keyframe of every animation leaves its element at rest.
        await page.waitForTimeout(MENU_SETTLE_MS);
        const started = (await readMotion(page)).animations;
        expect(started.length).toBeGreaterThan(0);
        for (const animation of started) {
            const keyframes = `${animation.name}: ${JSON.stringify(animation.frames)}`;
            expect(animation.still, keyframes).toBe(true);
            expect(animation.travelPx, keyframes).toBe(0);
            expect(animation.smallestScale, keyframes).toBe(1);
        }
    });
});
