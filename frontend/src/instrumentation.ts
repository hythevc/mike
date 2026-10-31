// Server-side Sentry bootstrap (Next.js instrumentation hook). Runs once per
// server runtime at boot; `onRequestError` catches errors thrown while
// rendering a route or running a route handler (the /api gateway, sitemaps).
// The Node runtime also checks the /api gateway's client-address setting at
// boot, so a missing CLIENT_IP_HEADER shows up in the startup log.
import * as Sentry from "@sentry/nextjs";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("../sentry.server.config");
        const { warnAboutClientAddressSetting } = await import(
            "@/app/api/[...path]/clientAddress"
        );
        warnAboutClientAddressSetting();
    }
    if (process.env.NEXT_RUNTIME === "edge") {
        await import("../sentry.edge.config");
    }
}

export const onRequestError = Sentry.captureRequestError;
