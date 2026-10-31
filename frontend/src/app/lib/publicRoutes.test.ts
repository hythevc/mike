// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTE_PREFIXES, isPublicRoute } from "./publicRoutes";

/** A page under `prefix`. */
function samplePublicPath(prefix: string): string {
    return prefix.endsWith("/") ? `${prefix}example` : prefix;
}

describe("isPublicRoute", () => {
    it("lists the public prefixes later pages are added under", () => {
        expect([...PUBLIC_ROUTE_PREFIXES]).toEqual([
            "/source",
            "/legal/",
            "/security",
            "/.well-known/",
            "/request/",
            "/docs",
            "/pricing",
        ]);
    });

    it.each(PUBLIC_ROUTE_PREFIXES.map((prefix) => [prefix]))(
        "treats pages under %s as public",
        (prefix) => {
            expect(isPublicRoute(samplePublicPath(prefix))).toBe(true);
            expect(isPublicRoute(`${prefix.replace(/\/$/, "")}/deeper/page`)).toBe(
                true,
            );
        },
    );

    it.each([
        "/sourcery",
        "/documents",
        "/docsx",
        "/legal",
        "/request",
        "/securityx",
        "/projects",
        "/assistant/chat/chat-1",
        "/",
        "",
        null,
        undefined,
    ])("keeps %s behind the gates", (pathname) => {
        expect(isPublicRoute(pathname)).toBe(false);
    });
});
