// SPDX-License-Identifier: AGPL-3.0-only
//
// Recognises the backend's session cookie by name, so a server component can
// tell a signed-in browser from a signed-out one without calling the API.
// The name is the persisted identifier the backend sets (lib/authSession.ts:
// `mike-session`, with the `__Host-` prefix on HTTPS), and a long session is
// split into `.1`, `.2`, ... chunks. Presence is all that is read: the value
// is never parsed here, and a stale cookie only sends the browser to the app,
// which then asks the API and shows the sign-in page.

const SESSION_COOKIE = /^(?:__Host-)?mike-session(?:[.-].*)?$/;

/** Whether `name` is the session cookie or one of its chunks. */
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
