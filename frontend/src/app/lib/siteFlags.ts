// SPDX-License-Identifier: AGPL-3.0-only
//
// The two build-time switches of the public site. Both are NEXT_PUBLIC_*
// values, so `next build` inlines them into the bundle: turning either on
// means rebuilding (for the Docker image, passing the build argument), as
// docs/deployment.md says next to the flags. They are read as literal
// `process.env.NEXT_PUBLIC_*` expressions on purpose; Next only replaces
// that exact form, so a lookup through a variable would stay undefined in
// the browser bundle.

/**
 * Whether `/` shows the public home page to signed-out visitors
 * (NEXT_PUBLIC_SITE_ENABLED is exactly "true"). Otherwise `/` keeps
 * redirecting to the app, as before the site existed. Signed-in users go to
 * the app either way.
 */
export function siteEnabled(): boolean {
    return process.env.NEXT_PUBLIC_SITE_ENABLED === "true";
}

/**
 * Whether search engines may index the public pages
 * (NEXT_PUBLIC_SITE_INDEXABLE is exactly "true"). Off by default: a preview
 * or a self-hosted install is not a product website, so robots.txt disallows
 * crawling and every page carries `noindex` until an operator opts in.
 */
export function siteIndexable(): boolean {
    return process.env.NEXT_PUBLIC_SITE_INDEXABLE === "true";
}

/**
 * The `robots` metadata for a public page: `noindex, nofollow` while the site
 * is not indexable, or while the page itself asks to stay out (a draft legal
 * document, for example); nothing otherwise, so the default applies.
 */
export function siteRobotsMetadata(options: { noindex?: boolean } = {}):
    | { index: false; follow: false }
    | undefined {
    if (options.noindex || !siteIndexable()) {
        return { index: false, follow: false };
    }
    return undefined;
}
