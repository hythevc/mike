// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }));
vi.mock("../sentry.server.config", () => ({}));
vi.mock("../sentry.edge.config", () => ({}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

async function bootWarnings(
    runtime: "nodejs" | "edge",
    env: Record<string, string>,
): Promise<string[]> {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { register } = await import("./instrumentation");

    await register();

    return warn.mock.calls.map((args) => String(args[0]));
}

it("warns at boot when a production web app has no client-address header", async () => {
    const warnings = await bootWarnings("nodejs", {
        NODE_ENV: "production",
        CLIENT_IP_HEADER: "",
    });

    expect(warnings).toEqual([expect.stringContaining("CLIENT_IP_HEADER is not set")]);
});

it("boots quietly once the header is configured", async () => {
    const warnings = await bootWarnings("nodejs", {
        NODE_ENV: "production",
        CLIENT_IP_HEADER: "x-real-ip",
    });

    expect(warnings).toEqual([]);
});

it("leaves the check to the Node runtime", async () => {
    const warnings = await bootWarnings("edge", {
        NODE_ENV: "production",
        CLIENT_IP_HEADER: "",
    });

    expect(warnings).toEqual([]);
});
