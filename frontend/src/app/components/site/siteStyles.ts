// SPDX-License-Identifier: AGPL-3.0-only
//
// Class names the public pages share, so a title, a section heading, a text
// link and the one filled action look the same on every page and are
// changed in one place. Colours are the semantic tokens; nothing here names
// a raw palette value or adds motion.

import { pillButtonUIClassName } from "@/shared/ui/PillButtonUI.styles";

/** The themed focus outline of a link on the public pages. */
export const SITE_FOCUS_CLASS =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Headings are set in the brand's display face (layout.tsx sets the variable). */
export const SITE_DISPLAY_STYLE = { fontFamily: "var(--brand-display-face)" } as const;

/** The h1 of a public page other than the home page. */
export const SITE_PAGE_TITLE_CLASS =
    "text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl";

/**
 * A section heading: a plain heading at the documented display size, between
 * the page title and the body. Never an uppercase, letter-spaced label.
 */
export const SITE_SECTION_HEADING_CLASS =
    "text-2xl font-medium tracking-tight text-balance text-fg";

/**
 * A heading inside a page that is read top to bottom (the contact page): one
 * step smaller, the size the documentation and security pages give theirs.
 */
export const SITE_SUBHEADING_CLASS = "text-xl font-medium tracking-tight text-fg";

/** A link inside a sentence, or standing as a secondary action. */
export const SITE_TEXT_LINK_CLASS = `rounded-sm font-medium text-fg underline underline-offset-4 hover:no-underline ${SITE_FOCUS_CLASS}`;

/**
 * A link that stands on its own in a row of actions: the same look, with a
 * 44px-tall target so it is as easy to hit as the button beside it.
 */
export const SITE_STANDALONE_LINK_CLASS = `inline-flex min-h-11 items-center text-sm ${SITE_TEXT_LINK_CLASS}`;

/**
 * The slot every primary action on a public page carries. Each page has one
 * action of this kind; the browser suite finds them by this slot to check
 * their size at phone widths.
 */
export const SITE_PRIMARY_ACTION_SLOT = "primary-action";

// The public pages' actions are 44px tall (h-11), taller than the app
// chrome's controls: they are the one thing a visitor is asked to press,
// often with a thumb. The pill itself is the shared primitive.
const SITE_ACTION_SIZE_CLASS = "h-11 px-5";

/** The page's one filled action. Pair it with `SITE_PRIMARY_ACTION_SLOT`. */
export function sitePrimaryActionClassName(): string {
    return pillButtonUIClassName({
        tone: "black",
        size: "normal",
        className: SITE_ACTION_SIZE_CLASS,
    });
}

/** An action that steps down from the primary one: same size, no fill. */
export function siteSecondaryActionClassName(): string {
    return pillButtonUIClassName({
        tone: "white",
        size: "normal",
        className: SITE_ACTION_SIZE_CLASS,
    });
}
