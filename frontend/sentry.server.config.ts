// Next.js Node runtime. SENTRY_DSN is read at container start, not build.
// Without a configured DSN no Sentry client is created at all.
import {
    describeReportingDestination,
    initServerErrorReporting,
    reportingDestination,
} from "@/app/lib/errorReporting";

initServerErrorReporting("server", process.env);

// Say once where this deployment's reports go (server and browser alike), so
// the answer is in the container log rather than inferred from the bundle.
if (process.env.NODE_ENV !== "test") {
    console.log(describeReportingDestination(reportingDestination(process.env)));
}
