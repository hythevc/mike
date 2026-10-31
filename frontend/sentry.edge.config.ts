// Next.js edge runtime (middleware/proxy, if any is ever added). Without a
// configured DSN no Sentry client is created at all.
import { initServerErrorReporting } from "@/app/lib/errorReporting";

initServerErrorReporting("edge", process.env);
