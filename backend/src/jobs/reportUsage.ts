// SPDX-License-Identifier: AGPL-3.0-only
//
// npm run report:usage --prefix backend (after npm run build): tokens and
// estimated cost per run, per document and per page from the usage ledger.
// See lib/usageReport.ts for the options and the price table.
//
// Unlike the other one-shot jobs this does not load ../instrument: it is a
// read-only operator report, so it starts no error tracking, sends nothing
// off the machine, and keeps stdout to the report alone (--json can be
// piped). dotenv still reads backend/.env.
import "dotenv/config";
import { safeError } from "../lib/safeError";
import { createServerSupabase } from "../lib/supabase";
import { loadUsageRows, runUsageReport } from "../lib/usageReport";

void runUsageReport({
  argv: process.argv.slice(2),
  env: process.env,
  loadRows: (filter) => loadUsageRows(createServerSupabase(), filter),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error("Usage report failed", safeError(error));
    process.exitCode = 1;
  },
);
