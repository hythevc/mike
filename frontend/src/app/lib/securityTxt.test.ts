// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/brand.generated";
import {
    SECURITY_TXT_VALIDITY_DAYS,
    securityTxt,
    securityTxtExpires,
} from "./securityTxt";

const NOW = new Date("2026-11-08T10:15:30.250Z");

describe("securityTxt", () => {
    it("names the brand's security mailbox as the contact", () => {
        expect(securityTxt(NOW)).toContain(
            `Contact: mailto:${brand.securityEmail}`,
        );
    });

    it("carries an Expires field in the future, as RFC 3339 whole seconds", () => {
        const body = securityTxt(NOW);
        const line = body.split("\n").find((l) => l.startsWith("Expires: "));
        expect(line).toBeDefined();
        const expires = new Date(line!.slice("Expires: ".length));
        expect(expires.getTime()).toBeGreaterThan(NOW.getTime());
        expect(expires.getTime() - NOW.getTime()).toBeLessThan(365 * 24 * 60 * 60 * 1000);
        expect(line).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("sets Expires a fixed number of days after the request", () => {
        expect(securityTxtExpires(NOW)).toBe(
            new Date(NOW.getTime() + SECURITY_TXT_VALIDITY_DAYS * 86_400_000)
                .toISOString()
                .replace(/\.\d{3}Z$/, "Z"),
        );
    });

    it("points at its canonical address and the security page", () => {
        const body = securityTxt(NOW);
        expect(body).toContain(
            `Canonical: ${new URL("/.well-known/security.txt", brand.appUrl)}`,
        );
        expect(body).toContain(
            `Policy: ${new URL(brand.legalDocuments.security.url, brand.appUrl)}`,
        );
        expect(body.endsWith("\n")).toBe(true);
    });

    it("defaults to the current time", () => {
        const before = Date.now();
        const line = securityTxt()
            .split("\n")
            .find((l) => l.startsWith("Expires: "))!;
        const expires = new Date(line.slice("Expires: ".length)).getTime();
        expect(expires).toBeGreaterThan(before);
    });
});
