// SPDX-License-Identifier: AGPL-3.0-only
import { isIP } from "node:net";

// The API keys its sign-in, email, MFA and public rate limits by the client
// address it reads from X-Forwarded-For. A browser can send that header
// itself, so the gateway never passes on what arrived: it forwards only the
// address the deployment's edge (CDN, load balancer or platform router) put
// in the header named by CLIENT_IP_HEADER, such as cf-connecting-ip,
// fly-client-ip or x-real-ip. Without that setting the API sees every request
// as coming from this server. See docs/deployment.md.

/** Header names as RFC 9110 defines a token, lower-cased. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

// Headers that state a client address and so must not pass through as sent.
const CLIENT_ADDRESS_HEADERS = ["x-forwarded-for", "forwarded"];

let warnedUnconfigured = false;

/** The configured edge header, lower-cased, or null when none is set. */
export function clientAddressHeader(
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    const name = env.CLIENT_IP_HEADER?.trim().toLowerCase();
    if (!name) return null;
    if (!HEADER_NAME.test(name)) {
        throw new Error("CLIENT_IP_HEADER must be an HTTP header name.");
    }
    return name;
}

function normalizedAddress(raw: string): string | null {
    let value = raw.trim();
    if (value.startsWith("[")) {
        // "[2001:db8::1]:443"
        const end = value.indexOf("]");
        if (end < 0) return null;
        value = value.slice(1, end);
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value)) {
        // "203.0.113.7:51234"
        value = value.slice(0, value.lastIndexOf(":"));
    }
    return isIP(value) ? value : null;
}

/**
 * The client address from the configured edge header. A list header such as
 * X-Forwarded-For contributes its right-most entry, the one the edge itself
 * appended; anything that is not an IP address counts as absent.
 */
export function trustedClientAddress(
    incoming: Headers,
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    const name = clientAddressHeader(env);
    if (!name) return null;
    const entries = (incoming.get(name) ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    const last = entries.at(-1);
    return last ? normalizedAddress(last) : null;
}

/**
 * Replace the client-address headers of a request about to be proxied: drop
 * whatever the client sent and, when the edge supplied a valid address, state
 * that one alone in X-Forwarded-For.
 */
export function forwardClientAddress(
    outgoing: Headers,
    incoming: Headers,
    env: NodeJS.ProcessEnv = process.env,
): void {
    const address = trustedClientAddress(incoming, env);
    for (const name of CLIENT_ADDRESS_HEADERS) outgoing.delete(name);
    if (address) outgoing.set("x-forwarded-for", address);

    if (!warnedUnconfigured && env.NODE_ENV === "production" && !clientAddressHeader(env)) {
        warnedUnconfigured = true;
        // A warning, not an error: the console bridge files errors as events.
        console.warn(
            "[api-gateway] CLIENT_IP_HEADER is not set, so the API sees every " +
                "browser at this server's address and per-address rate limits " +
                "are shared by all users. Set it to the client-address header " +
                "your edge sets (docs/deployment.md).",
        );
    }
}

/** Test seam: forget that the missing-setting warning was printed. */
export function resetClientAddressWarning(): void {
    warnedUnconfigured = false;
}
