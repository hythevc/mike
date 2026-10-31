import { afterEach, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
    init: vi.fn(),
    captureConsoleIntegration: vi.fn(() => ({ name: "CaptureConsole" })),
    captureRouterTransitionStart: vi.fn(),
}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
});

/** Stands in for GET /monitoring on the Next server. */
function serverAnswers(body: unknown) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

it.each(["", "true", "false"])(
    "creates no browser client when no DSN is configured (baked disabled=%s)",
    async (disabled) => {
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DISABLED", disabled);
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
        const fetch = serverAnswers({ reports: "none", see: "docs/observability.md#configuration" });
        const { onRouterTransitionStart } = await import("./instrumentation-client");
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/monitoring", expect.anything()));
        // Let the answer settle before checking that nothing was started.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(Sentry.init).not.toHaveBeenCalled();
        expect(onRouterTransitionStart).toBe(Sentry.captureRouterTransitionStart);
    },
);

it("starts through the runtime tunnel when the server has a DSN at runtime", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    serverAnswers({ reports: "runtime" });
    await import("./instrumentation-client");
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalledOnce());
    expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
            enabled: true,
            tunnel: "/monitoring",
            dsn: expect.stringMatching(/^https:\/\//),
        }),
    );
});

it.each(["https://key@sentry.example/7", "invalid-baked-dsn"])(
    "starts during module evaluation when a DSN is baked into the bundle (%s)",
    async (baked) => {
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DISABLED", "");
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", baked);
        const fetch = serverAnswers({ reports: "build" });
        await import("./instrumentation-client");
        // Before any await, so errors thrown during hydration are covered. The
        // SDK gets the placeholder DSN; the tunnel decides where envelopes go,
        // so even a malformed baked value cannot send anywhere by itself.
        expect(Sentry.init).toHaveBeenCalledOnce();
        expect(Sentry.init).toHaveBeenCalledWith(
            expect.objectContaining({ tunnel: "/monitoring", dsn: expect.stringMatching(/^https:\/\//) }),
        );
        expect(fetch).not.toHaveBeenCalled();
    },
);
