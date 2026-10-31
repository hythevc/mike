// Browser-side Sentry bootstrap. Next.js loads this file before any page
// code runs. The NEXT_PUBLIC_* references must stay literal: Next inlines
// them at build time. No Sentry client is created unless the deployment
// configured a DSN: a DSN baked into the bundle starts reporting at once
// (hydration errors included); otherwise the page asks the Next server
// whether one is set at runtime (startBrowserErrorReporting). Either way the
// same-origin tunnel applies the runtime opt-out and destination.
import * as Sentry from "@sentry/nextjs";
import { startBrowserErrorReporting } from "@/app/lib/errorReporting";

void startBrowserErrorReporting({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    disabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED,
    install: process.env.NEXT_PUBLIC_SENTRY_INSTALL,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    version: process.env.NEXT_PUBLIC_MIKE_VERSION,
    gitSha: process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    nodeEnv: process.env.NODE_ENV,
});

// Lets Sentry attribute an error to the client-side navigation it happened in
// (a no-op while no client exists).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
