// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared accessibility gate for the web app's Playwright specs.
 *
 * Every page a spec covers goes through `expectAccessible`, which pins the
 * theme, waits for the page to settle, runs axe-core and applies one policy:
 *
 * - `critical` violations fail on every page, in both themes.
 * - `serious` violations are held to a per-page ratchet in axe-ratchet.json:
 *   the number of serious rules a page and theme violates may not grow. A
 *   page with no entry may have none. Lower an entry when a fix lands; never
 *   raise one to let a new problem through.
 * - Everything else (moderate, minor) is printed, not enforced.
 *
 * Counts are of violated rules, not affected elements, so one more row in a
 * table does not change them. A spec that adds a page scans it here, in both
 * themes; docs/design-system.md describes the gate.
 */
import fs from "fs";
import path from "path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

/** Impacts that fail a scan on any page. */
export const BLOCKING_IMPACTS: readonly string[] = ["critical"];

/** The impact held to axe-ratchet.json. */
export const RATCHETED_IMPACT = "serious";

/**
 * Parts of the page that are not the product's own interface. Next.js mounts
 * its development overlay in `nextjs-portal` under `next dev` only.
 */
const EXCLUDED_SELECTORS = ["nextjs-portal"];

interface RatchetEntry {
    /** Most serious rules this page and theme may violate. */
    serious: number;
    /** The rules that made up that count when it was last set. */
    rules: string[];
}

type Ratchet = Record<string, Partial<Record<Theme, RatchetEntry>>>;

const RATCHET_FILE = path.join(__dirname, "axe-ratchet.json");

function loadRatchet(): Ratchet {
    const parsed: unknown = JSON.parse(fs.readFileSync(RATCHET_FILE, "utf8"));
    const pages = (parsed as { pages?: unknown }).pages;
    if (!pages || typeof pages !== "object") {
        throw new Error(`${RATCHET_FILE}: expected a "pages" object`);
    }
    for (const [page, themes] of Object.entries(pages)) {
        for (const [theme, entry] of Object.entries(themes ?? {})) {
            const { serious, rules } = (entry ?? {}) as Partial<RatchetEntry>;
            if (
                !THEMES.includes(theme as Theme) ||
                !Number.isInteger(serious) ||
                (serious as number) < 0 ||
                !Array.isArray(rules) ||
                rules.length !== serious
            ) {
                throw new Error(
                    `${RATCHET_FILE}: ${page} ${theme} needs a "serious" count that matches its "rules" list`,
                );
            }
        }
    }
    return pages as Ratchet;
}

const ratchet = loadRatchet();

/** The serious-rule allowance for a page and theme; none when unlisted. */
export function ratchetFor(page: string, theme: Theme): RatchetEntry {
    return ratchet[page]?.[theme] ?? { serious: 0, rules: [] };
}

/**
 * Shows the page in `theme` by pinning the `.dark` class (and the matching
 * `color-scheme`) on the root element, as the Appearance preference does.
 * The account's stored preference, which other specs share, is not changed:
 * an observer puts the class back if the app reapplies the stored one.
 */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((wanted) => {
        const root = document.documentElement;
        const apply = () => {
            const dark = wanted === "dark";
            if (root.classList.contains("dark") !== dark) {
                root.classList.toggle("dark", dark);
            }
            if (root.style.colorScheme !== wanted) {
                root.style.colorScheme = wanted;
            }
        };
        const holder = window as Window & { __axeTheme?: MutationObserver };
        holder.__axeTheme?.disconnect();
        apply();
        holder.__axeTheme = new MutationObserver(apply);
        holder.__axeTheme.observe(root, {
            attributes: true,
            attributeFilter: ["class", "style"],
        });
    }, theme);
    await expect
        .poll(() =>
            page.evaluate(() =>
                document.documentElement.classList.contains("dark"),
            ),
        )
        .toBe(theme === "dark");
}

/**
 * Waits until the page shows content rather than placeholders: no skeleton
 * pulses inside `main`, and no transition or other finite animation still
 * running, so contrast is measured on final colors.
 */
export async function waitForSettledPage(page: Page): Promise<void> {
    await expect
        .poll(() => page.locator("main .animate-pulse").count(), {
            message: "loading placeholders are still on the page",
            timeout: 20_000,
        })
        .toBe(0);
    await page.evaluate(() => {
        const running = document
            .getAnimations()
            .filter(
                (animation) =>
                    animation.playState === "running" &&
                    animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => undefined));
        // Bounded, so an animation that never finishes cannot hang the scan.
        return Promise.race([
            Promise.all(running),
            new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
    });
}

interface Violation {
    id: string;
    impact?: string | null;
    helpUrl: string;
    nodes: { target: unknown[] }[];
}

function summarize(violation: Violation): string {
    const targets = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ");
    return `[${violation.impact}] ${violation.id} (${violation.nodes.length} element${
        violation.nodes.length === 1 ? "" : "s"
    }: ${targets}${violation.nodes.length > 3 ? ", ..." : ""}) ${violation.helpUrl}`;
}

/**
 * Scans the page as it is now, in `theme`, and enforces the policy above.
 * `name` is the page's key in axe-ratchet.json, normally its path.
 */
export async function expectAccessible(
    page: Page,
    { name, theme }: { name: string; theme: Theme },
): Promise<void> {
    await setTheme(page, theme);
    await waitForSettledPage(page);

    let builder = new AxeBuilder({ page }).options({
        resultTypes: ["violations"],
    });
    for (const selector of EXCLUDED_SELECTORS) builder = builder.exclude(selector);
    const { violations } = await builder.analyze();

    const label = `${name} (${theme})`;
    const blocking = violations.filter((v) =>
        BLOCKING_IMPACTS.includes(v.impact ?? ""),
    );
    const serious = violations.filter((v) => v.impact === RATCHETED_IMPACT);
    const other = violations.filter(
        (v) => !BLOCKING_IMPACTS.includes(v.impact ?? "") && v.impact !== RATCHETED_IMPACT,
    );
    const allowance = ratchetFor(name, theme);

    if (serious.length > 0 || other.length > 0) {
        console.log(
            `[a11y] ${label}: ${serious.length} serious (ratchet ${allowance.serious}), ${other.length} other\n` +
                [...serious, ...other].map((v) => `  ${summarize(v)}`).join("\n"),
        );
    }
    if (serious.length < allowance.serious) {
        console.log(
            `[a11y] ${label}: ${allowance.serious - serious.length} serious rule(s) fixed. ` +
                `Lower its entry in e2e/axe-ratchet.json to ${serious.length}: ` +
                JSON.stringify({ serious: serious.length, rules: serious.map((v) => v.id).sort() }),
        );
    }

    expect(
        blocking.map(summarize),
        `${BLOCKING_IMPACTS.join("/")} axe violations on ${label}`,
    ).toEqual([]);

    const unrecorded = serious
        .filter((v) => !allowance.rules.includes(v.id))
        .map((v) => v.id);
    expect(
        serious.length,
        `serious axe violations on ${label} exceed e2e/axe-ratchet.json ` +
            `(${allowance.serious}: ${allowance.rules.join(", ") || "none"}). ` +
            `Not in the ratchet: ${unrecorded.join(", ") || "none"}.\n` +
            serious.map((v) => `  ${summarize(v)}`).join("\n"),
    ).toBeLessThanOrEqual(allowance.serious);
}

/**
 * `expectAccessible` in the light theme and then the dark theme, on the page
 * as it is now. For specs that add a page: one call covers both themes.
 */
export async function expectAccessibleInEveryTheme(
    page: Page,
    name: string,
): Promise<void> {
    for (const theme of THEMES) await expectAccessible(page, { name, theme });
}
