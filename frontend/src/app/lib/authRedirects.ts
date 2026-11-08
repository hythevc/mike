const AUTH_REDIRECT_PATHS = new Set([
    "/assistant",
    "/login",
    "/reset-password",
    "/settings",
    "/onboarding/profile",
    "/onboarding/practice",
    "/onboarding/invitations",
    "/onboarding/models",
]);

/**
 * The top-level routes of the signed-in app (the `(pages)` route group). A
 * link into any of them survives sign-in and onboarding as `?next`.
 * `authRedirects.test.ts` fails when a top-level page is missing here.
 */
const APP_ROUTE_ROOTS = [
    "/assistant",
    "/history",
    "/ide",
    "/intake",
    "/library",
    "/organizations",
    "/playbooks",
    "/projects",
    "/settings",
    "/tabular-reviews",
    "/workflows",
] as const;

/** Where someone lands once signed in, when no page asked for them. */
export const DEFAULT_SIGNED_IN_PATH = "/assistant";

/**
 * The first onboarding step. Signing in goes here when no page asked for the
 * user; the onboarding gate sends someone who has finished onboarding on.
 */
export const ONBOARDING_START_PATH = "/onboarding/profile";

const POST_ONBOARDING_DESTINATION_KEY = "auth:post-onboarding-destination";

function pathOf(destination: string): string {
    return destination.split("?", 1)[0];
}

function isAppRoute(destination: string): boolean {
    const path = pathOf(destination);
    return APP_ROUTE_ROOTS.some(
        (root) => path === root || path.startsWith(`${root}/`),
    );
}

export function safeAuthNext(
    candidate: string | null | undefined,
    fallback = "/assistant",
): string {
    if (
        !candidate ||
        !candidate.startsWith("/") ||
        candidate.startsWith("//")
    ) {
        return fallback;
    }
    if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) {
        return fallback;
    }

    const base = new URL("https://auth.mike.local");
    const resolved = new URL(candidate, base);
    if (
        resolved.origin !== base.origin ||
        !(
            AUTH_REDIRECT_PATHS.has(resolved.pathname) ||
            isAppRoute(resolved.pathname)
        )
    ) {
        return fallback;
    }
    return `${resolved.pathname}${resolved.search}`;
}

function withNext(
    page: "/login" | "/signup",
    destination: string | null | undefined,
): string {
    const next = safeAuthNext(destination, "");
    if (!next || !isAppRoute(next) || next === DEFAULT_SIGNED_IN_PATH) {
        return page;
    }
    return `${page}?next=${encodeURIComponent(next)}`;
}

/**
 * The sign-in page for someone sent away from `destination`. The page they
 * asked for rides along as `?next`, so signing in returns them to it; the
 * default landing page, and anything that is not a page of the app, does not.
 */
export function loginPathFor(destination: string | null | undefined): string {
    return withNext("/login", destination);
}

/**
 * The sign-up page for someone who reached sign-in on the way to
 * `destination`, keeping that page as `?next` by the same rule as
 * `loginPathFor`: a new account then lands there, through onboarding.
 */
export function signupPathFor(destination: string | null | undefined): string {
    return withNext("/signup", destination);
}

/**
 * Where a successful sign-in goes for `/login?next=…`: the page in `next`
 * when it is a page of the app, otherwise the first onboarding step (which
 * sends someone who has finished onboarding on to the app).
 */
export function postLoginDestination(next: string | null | undefined): string {
    const destination = safeAuthNext(next, "");
    return destination && isAppRoute(destination)
        ? destination
        : ONBOARDING_START_PATH;
}

/**
 * Remember the page someone was on when the onboarding gate sent them to
 * onboarding, so finishing onboarding takes them back to it. Kept per
 * browser tab and per user; only pages of the app are remembered.
 */
export function rememberPostOnboardingDestination(
    userId: string,
    destination: string,
): void {
    const path = safeAuthNext(destination, "");
    if (!path || !isAppRoute(path)) return;
    try {
        window.sessionStorage.setItem(
            POST_ONBOARDING_DESTINATION_KEY,
            JSON.stringify({ userId, path }),
        );
    } catch {
        // Storage is blocked (private mode, a locked-down browser). Finishing
        // onboarding then lands on the default page: the link is lost, not
        // the work.
    }
}

/**
 * The page `userId` asked for before onboarding, or the default signed-in
 * page. It is read, not consumed: the gate and the last onboarding step
 * both ask, and both must send the user to the same place.
 */
export function postOnboardingDestination(userId: string): string {
    let raw: string | null = null;
    try {
        raw = window.sessionStorage.getItem(POST_ONBOARDING_DESTINATION_KEY);
    } catch {
        // Same as above: without storage there is nothing to return to.
    }
    if (!raw) return DEFAULT_SIGNED_IN_PATH;
    let saved: unknown = null;
    try {
        saved = JSON.parse(raw);
    } catch {
        // A value this code did not write: ignore it.
    }
    if (
        !saved ||
        typeof saved !== "object" ||
        (saved as { userId?: unknown }).userId !== userId
    ) {
        return DEFAULT_SIGNED_IN_PATH;
    }
    const path = (saved as { path?: unknown }).path;
    const destination =
        typeof path === "string" ? safeAuthNext(path, "") : "";
    return destination && isAppRoute(destination)
        ? destination
        : DEFAULT_SIGNED_IN_PATH;
}

/** Drop the remembered page once the user has arrived in the app. */
export function forgetPostOnboardingDestination(): void {
    try {
        window.sessionStorage.removeItem(POST_ONBOARDING_DESTINATION_KEY);
    } catch {
        // Nothing was stored if storage is unavailable.
    }
}

export function authErrorDescription(
    search: string,
    hash: string,
): string | null {
    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(hash.replace(/^#/, ""));
    const error = (
        query.get("error_description") ||
        query.get("error") ||
        fragment.get("error_description") ||
        fragment.get("error")
    );
    if (!error) return null;
    if (/expired|invalid/i.test(error)) {
        return "This confirmation link is invalid or has expired.";
    }
    if (/access.denied|cancel/i.test(error)) {
        return "Authentication was cancelled or denied.";
    }
    return "Authentication could not be completed. Please try again.";
}
