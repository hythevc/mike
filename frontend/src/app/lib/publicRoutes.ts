// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Route prefixes anyone may open, signed in or not.
 *
 * The onboarding and MFA gates render these routes without redirecting, so a
 * public page added under one of them needs no change to either gate. A
 * prefix without a trailing slash covers that path and every path below it;
 * a prefix ending in a slash covers only the paths below it.
 *
 * Nothing here grants access to data: a public page must not depend on the
 * visitor's session to render.
 */
export const PUBLIC_ROUTE_PREFIXES = [
    "/source",
    "/legal/",
    "/security",
    "/.well-known/",
    "/request/",
    "/docs",
    "/pricing",
] as const;

/** Whether `pathname` falls under one of `PUBLIC_ROUTE_PREFIXES`. */
export function isPublicRoute(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return PUBLIC_ROUTE_PREFIXES.some((prefix) =>
        prefix.endsWith("/")
            ? pathname.startsWith(prefix)
            : pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}
