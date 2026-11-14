// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// The public pages are static: nothing fades in as the reader scrolls,
// nothing counts up, slides or loops, and no script watches the scroll
// position. This reads the source of the site's components and pages and
// fails on the code such effects are made of, and on the motion utilities
// the motion rules forbid. Test files are not scanned, so the patterns below
// do not find themselves.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname, "..", "..");
const SCANNED_DIRS = [
    path.join(APP_DIR, "components", "site"),
    path.join(APP_DIR, "(site)"),
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

const RULES: { label: string; pattern: RegExp }[] = [
    { label: "IntersectionObserver", pattern: /IntersectionObserver/ },
    { label: "a scroll listener", pattern: /\bonScroll\b|addEventListener\(\s*["'`]scroll/ },
    {
        label: "reading the scroll position",
        pattern: /\b(?:scrollY|scrollX|scrollTop|pageYOffset)\b/,
    },
    {
        label: "a scroll-driven animation",
        pattern: /\b(?:animation-timeline|scroll-timeline|view-timeline)\b/,
    },
    {
        label: "an in-view helper",
        pattern: /\b(?:useInView|whileInView|useScroll|data-aos)\b/,
    },
    {
        label: "a reveal class",
        pattern: /\b(?:reveal|in-view|inview|on-scroll|scroll-reveal|fade-(?:in|up|down))\b/,
    },
    { label: "a marquee, parallax or count-up", pattern: /\b(?:marquee|parallax|count-?up)\b/i },
    { label: "an animation utility", pattern: /\banimate-/ },
    { label: "transition-all", pattern: /\btransition-all\b/ },
    { label: "a bare ease-in", pattern: /\bease-in\b(?!-)/ },
    { label: "a raw duration", pattern: /\bduration-\d/ },
];

function problems(label: string, text: string): string[] {
    return RULES.filter((rule) => rule.pattern.test(text)).map(
        (rule) => `${label}: ${rule.label}`,
    );
}

describe("the public pages are static", () => {
    const files = SCANNED_DIRS.flatMap(sourceFiles);

    it("scans the site's components and its pages", () => {
        const names = files.map((file) => path.relative(APP_DIR, file));
        for (const expected of [
            path.join("components", "site", "HomeContent.tsx"),
            path.join("components", "site", "ProductVignette.tsx"),
            path.join("components", "site", "PricingPlans.tsx"),
            path.join("components", "site", "TrustStrip.tsx"),
            path.join("components", "site", "SiteHeader.tsx"),
            path.join("components", "site", "SiteNav.tsx"),
            path.join("components", "site", "SiteFooter.tsx"),
            path.join("(site)", "contact", "page.tsx"),
            path.join("(site)", "pricing", "page.tsx"),
        ]) {
            expect(names, expected).toContain(expected);
        }
        expect(names.some((name) => /\.test\.tsx?$/.test(name))).toBe(false);
    });

    it("has no IntersectionObserver, scroll-triggered class or forbidden motion utility", () => {
        const found = files.flatMap((file) =>
            problems(path.relative(APP_DIR, file), readFileSync(file, "utf8")),
        );
        expect(found).toEqual([]);
    });
});

describe("the check fires on what it forbids", () => {
    it.each([
        ["IntersectionObserver", "const seen = new IntersectionObserver(show);"],
        ["a scroll listener", 'window.addEventListener("scroll", onMove);'],
        ["a scroll listener", "<div onScroll={handle} />"],
        ["reading the scroll position", "const top = window.scrollY;"],
        ["a scroll-driven animation", "animation-timeline: view();"],
        ["an in-view helper", "const visible = useInView(ref);"],
        ["a reveal class", '<section className="reveal" />'],
        ["a reveal class", '<section className="fade-up" />'],
        ["a marquee, parallax or count-up", '<div className="marquee" />'],
        ["a marquee, parallax or count-up", "<CountUp end={total} />"],
        ["an animation utility", '<div className="animate-pulse" />'],
        ["an animation utility", '<div className="animate-[rise_1s]" />'],
        ["transition-all", '<a className="transition-all" />'],
        ["a bare ease-in", '<a className="ease-in" />'],
        ["a raw duration", '<a className="duration-300" />'],
    ])("flags %s", (label, source) => {
        expect(problems("fixture.tsx", source)).toContain(`fixture.tsx: ${label}`);
    });

    it("lets through what is not an effect", () => {
        const source = [
            "// Nothing here waits for the page to scroll, and nothing animates.",
            '<a className="scroll-mt-6 ease-in-out underline" href="#summary">Summary</a>',
            '<p className="text-fg-subtle">Counting up to three plans.</p>',
        ].join("\n");
        expect(problems("fixture.tsx", source)).toEqual([]);
    });
});
