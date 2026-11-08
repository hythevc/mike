// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/shared/brand.generated";
import { GET, dynamic } from "./route";

describe("GET /.well-known/security.txt", () => {
    it("returns a plain-text file naming the security mailbox with a future Expires", async () => {
        const response = GET();
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/plain");
        const body = await response.text();
        expect(body).toContain(`Contact: mailto:${brand.securityEmail}`);
        const expires = body.split("\n").find((line) => line.startsWith("Expires: "));
        expect(expires).toBeDefined();
        expect(new Date(expires!.slice("Expires: ".length)).getTime()).toBeGreaterThan(
            Date.now(),
        );
    });

    it("is rendered per request, never baked into the build", () => {
        expect(dynamic).toBe("force-dynamic");
    });
});
