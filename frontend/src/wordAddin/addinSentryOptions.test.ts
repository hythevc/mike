// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Word add-in reports nothing unless a DSN is baked into its bundle at
 * build time: without one, no Sentry client is created by any entry (task
 * pane, ribbon commands, OAuth dialog). Exercised from the frontend runner
 * through the add-in's `@mike/*` aliases, like the other add-in tests here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/react", () => ({
    init: vi.fn(),
    isEnabled: vi.fn(() => false),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn(),
    captureConsoleIntegration: vi.fn(() => ({ name: "CaptureConsole" })),
    ErrorBoundary: () => null,
}));

import * as Sentry from "@sentry/react";
import {
    addinSentryOptions,
    initAddinErrorReporting,
    reportError,
} from "../../../word-addin/src/taskpane/lib/errorReporting";

const SURFACES = ["taskpane", "commands", "oauth-dialog"] as const;

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe("add-in reporting without a DSN", () => {
    it("builds options that are off for every surface", () => {
        for (const surface of SURFACES) {
            for (const env of [{}, { dsn: "" }, { dsn: "   " }, { disabled: "false" }]) {
                const options = addinSentryOptions(surface, env);
                expect(options.enabled).toBe(false);
                expect(options.dsn).toBeUndefined();
            }
        }
    });

    it("creates no client from any entry point", () => {
        vi.stubEnv("REACT_APP_SENTRY_DSN", "");
        vi.stubEnv("REACT_APP_SENTRY_DISABLED", "");
        for (const surface of SURFACES) {
            expect(initAddinErrorReporting(surface)).toBe(false);
        }
        expect(Sentry.init).not.toHaveBeenCalled();
        // And reporting stays a no-op.
        expect(reportError(new Error("x"))).toBeNull();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});

describe("add-in reporting with an operator DSN", () => {
    const dsn = "https://key@sentry.example/3";

    it("starts the client with that DSN", () => {
        vi.stubEnv("REACT_APP_SENTRY_DSN", ` ${dsn} `);
        expect(initAddinErrorReporting("taskpane")).toBe(true);
        expect(Sentry.init).toHaveBeenCalledOnce();
        expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]).toMatchObject({ dsn, enabled: true });
    });

    it("stays off when the build also switched reporting off", () => {
        vi.stubEnv("REACT_APP_SENTRY_DSN", dsn);
        vi.stubEnv("REACT_APP_SENTRY_DISABLED", "true");
        expect(initAddinErrorReporting("commands")).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
    });
});
