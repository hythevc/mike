// SPDX-License-Identifier: AGPL-3.0-only

/** Controls that take keyboard focus in the normal tab order. */
const TABBABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(", ");

function firstTabbable(element: Element | null): HTMLElement | null {
    if (!(element instanceof HTMLElement)) return null;
    if (element.matches(TABBABLE)) return element;
    return element.querySelector<HTMLElement>(TABBABLE);
}

/**
 * Move keyboard focus off a list item that is about to leave the page, so
 * it does not fall back to the top of the document: to the next item's
 * first control, else the previous item's, else the nearest container that
 * can take focus (one with a `tabindex`, such as `tabIndex={-1}`). Call it
 * while the item is still on the page. Returns whether focus moved.
 */
export function focusNeighbour(item: HTMLElement | null): boolean {
    if (!item) return false;
    const target =
        firstTabbable(item.nextElementSibling) ??
        firstTabbable(item.previousElementSibling) ??
        item.parentElement?.closest<HTMLElement>("[tabindex]") ??
        null;
    if (!target) return false;
    target.focus();
    return true;
}
