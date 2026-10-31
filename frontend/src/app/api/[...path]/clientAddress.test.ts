// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import {
    clientAddressHeader,
    forwardClientAddress,
    trustedClientAddress,
    warnAboutClientAddressSetting,
} from "./clientAddress";

const env = (CLIENT_IP_HEADER?: string) =>
    ({ NODE_ENV: "test", CLIENT_IP_HEADER }) as NodeJS.ProcessEnv;

describe("clientAddressHeader", () => {
    it("is unset unless configured, and lower-cases the name", () => {
        expect(clientAddressHeader(env())).toBeNull();
        expect(clientAddressHeader(env("   "))).toBeNull();
        expect(clientAddressHeader(env(" Fly-Client-IP "))).toBe("fly-client-ip");
    });

    it("rejects a value that is not a header name", () => {
        expect(() => clientAddressHeader(env("client ip"))).toThrow(
            "CLIENT_IP_HEADER must be an HTTP header name.",
        );
    });
});

describe("trustedClientAddress", () => {
    const read = (value: string, name = "cf-connecting-ip") =>
        trustedClientAddress(new Headers({ [name]: value }), env(name));

    it.each([
        ["203.0.113.7", "203.0.113.7"],
        [" 203.0.113.7 ", "203.0.113.7"],
        ["203.0.113.7:51234", "203.0.113.7"],
        ["2001:db8::1", "2001:db8::1"],
        ["[2001:db8::1]:443", "2001:db8::1"],
        ["198.51.100.66, 203.0.113.7", "203.0.113.7"],
        ["198.51.100.66,", "198.51.100.66"],
    ])("reads %j as %s", (value, expected) => {
        expect(read(value)).toBe(expected);
    });

    it.each(["", "unknown", "203.0.113.7, not-an-address", "[2001:db8::1", "999.1.1.1"])(
        "treats %j as no address",
        (value) => {
            expect(read(value)).toBeNull();
        },
    );

    it("reads nothing when no header is configured", () => {
        const incoming = new Headers({ "x-forwarded-for": "198.51.100.66" });
        expect(trustedClientAddress(incoming, env())).toBeNull();
    });
});

describe("forwardClientAddress", () => {
    it("replaces whatever the client sent with the edge's address", () => {
        const incoming = new Headers({
            "x-real-ip": "203.0.113.7",
            "x-forwarded-for": "198.51.100.66",
            forwarded: "for=198.51.100.66",
        });
        const outgoing = new Headers(incoming);

        forwardClientAddress(outgoing, incoming, env("x-real-ip"));

        expect(outgoing.get("x-forwarded-for")).toBe("203.0.113.7");
        expect(outgoing.get("forwarded")).toBeNull();
    });

    it("strips the client's values when the edge supplied none", () => {
        const incoming = new Headers({
            "x-forwarded-for": "198.51.100.66",
            forwarded: "for=198.51.100.66",
        });
        const outgoing = new Headers(incoming);

        forwardClientAddress(outgoing, incoming, env());

        expect(outgoing.get("x-forwarded-for")).toBeNull();
        expect(outgoing.get("forwarded")).toBeNull();
    });
});

describe("warnAboutClientAddressSetting", () => {
    const warningsFor = (NODE_ENV: string, CLIENT_IP_HEADER?: string) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            warnAboutClientAddressSetting({ NODE_ENV, CLIENT_IP_HEADER } as NodeJS.ProcessEnv);
            return warn.mock.calls.map((args) => String(args[0]));
        } finally {
            warn.mockRestore();
        }
    };

    it("warns a production server that has no edge header", () => {
        const warnings = warningsFor("production");

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("CLIENT_IP_HEADER is not set");
        expect(warnings[0]).toContain("Rate limits and client addresses");
    });

    it("treats a blank setting as unset", () => {
        expect(warningsFor("production", "  ")).toHaveLength(1);
    });

    it("is quiet once the header is configured, or outside production", () => {
        expect(warningsFor("production", "cf-connecting-ip")).toEqual([]);
        expect(warningsFor("development")).toEqual([]);
        expect(warningsFor("test")).toEqual([]);
    });

    it.each(["production", "development"])(
        "reports a setting that is not a header name without throwing (%s)",
        (NODE_ENV) => {
            const warnings = warningsFor(NODE_ENV, "client ip");

            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain("CLIENT_IP_HEADER is not an HTTP header name");
        },
    );
});
