// SPDX-License-Identifier: AGPL-3.0-only
//
// Recognises the backend's session cookie by name, so a server component can
// tell a signed-in browser from a signed-out one without calling the API.
// The name is the persisted identifier the backend sets (lib/authSession.ts:
// `mike-session`, with the `__Host-` prefix on HTTPS), and a long session is
// split into `.0`, `.1`, ... chunks. Presence is all that is read: the value
// is never parsed here, and a stale cookie only sends the browser to the app,
// which then asks the API and shows the sign-in page.
//
// Deliberately not recognised: `mike-session-code-verifier`, the PKCE
// verifier the backend writes beside the session name when a visitor clicks
// a provider's sign-in button (POST /auth/oauth). It lives for months and is
// cleared only when that sign-in completes, on sign-out or on a password
// change, so a visitor who clicked the button and backed out carries it for a
// long time without having a session. Counting it would send that visitor to
// the app, and from there to the sign-in page, on every visit, and so hide
// the home page from them; it says nothing about whether they are signed in.

const SESSION_COOKIE = /^(?:__Host-)?mike-session(?:\.\d+)?$/;

/** Whether `name` is the session cookie or one of its numbered chunks. */
export function isSessionCookieName(name: string): boolean {
    return SESSION_COOKIE.test(name);
}

/** Whether any of `names` (the request's cookie names) is a session cookie. */
export function hasSessionCookie(names: Iterable<string>): boolean {
    for (const name of names) {
        if (isSessionCookieName(name)) return true;
    }
    return false;
}
