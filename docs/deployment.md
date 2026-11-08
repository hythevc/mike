# Manual and production deployment

Use this path when connecting Mike to managed Supabase and S3-compatible
storage instead of the infrastructure bundled with Docker Compose.

## Prerequisites

- Node.js 22 or newer
- npm and Git
- A Supabase project
- A Cloudflare R2, MinIO, or other S3-compatible bucket
- At least one supported model-provider API key, or an accessible Ollama server
- Optional: CourtListener bulk data for case-law tools without a token (each
  user can instead add their own CourtListener token in Settings > Connectors)
- LibreOffice when DOC/DOCX-to-PDF conversion is required

## Database setup

Every Mike database records the migrations it has applied in
`public.schema_migrations`, one row per file in `backend/migrations/`.
`backend/scripts/migrate.sh` reads that table and applies only the files it
does not list, in filename order, adding a row after each one succeeds. The
script needs bash and `psql`, and a `DATABASE_URL` for a role that owns the
`public` schema: on Supabase, the `postgres` direct or session-pooler
connection string (not the transaction pooler).

### Fresh install

Run the contents of `backend/schema.sql` in the Supabase SQL editor (or with
`psql`). It contains the complete current database shape and records every
migration it already includes, so there is nothing to apply afterwards.

### Upgrading an existing deployment

Do not run the complete schema over production data. Back up the database,
then check and apply what is pending:

```bash
export DATABASE_URL='postgresql://postgres:<password>@<host>:5432/postgres'
backend/scripts/migrate.sh status   # lists pending files; exits 2 if any
backend/scripts/migrate.sh up
```

`up` stops at the first migration that fails; that file and everything after
it stay pending, so fix the cause and run `up` again. Each file runs in a
transaction with its ledger row, so a failed one leaves nothing behind. The
exceptions are files that manage their own transaction, use `create index
concurrently`, or carry a `-- migrate:no-transaction` line (`up` prints "(no
transaction)" for them): a failure there can leave part of the file applied,
so restore the backup, or finish that file by hand and record it with `mark`
(below).

A wrapped file holds its table locks until it commits. On a busy database,
set a lock timeout so a migration that cannot get its locks fails and rolls
back instead of queueing application queries behind it, then retry:

```bash
PGOPTIONS='-c lock_timeout=10s' backend/scripts/migrate.sh up
```

The runner holds a PostgreSQL advisory lock while it writes, so a second run
against the same database (Compose's `db-init` and an operator, or two deploy
jobs) waits for the first, then skips what it applied. A waiting run names the
session holding the lock (its sessions show as `migrate.sh` in
`pg_stat_activity`) and gives up after `MIGRATE_LOCK_WAIT` seconds (default
900). The lock needs a session connection, which is why the transaction pooler
will not do; the runner refuses a URL on its port, 6543.

`status` and `up` also warn about two kinds of mismatch. A file that "has
changed since it was applied" was edited after you ran it. A file "recorded as
applied but not in backend/migrations" was usually renamed after you ran it,
so its new name now shows as pending: if it is the same migration, record the
new name with `mark` instead of running it a second time.

To apply a migration some other way, such as in the SQL editor, record it
afterwards so the runner skips it:

```bash
backend/scripts/migrate.sh mark <file>.sql
```

or, in the SQL editor, `insert into public.schema_migrations (filename) values
('<file>.sql');`. To see what a database has run:

```sql
select filename, applied_at, checksum is not null as run_by_migrate_sh
from public.schema_migrations
order by filename;
```

### Adopting the ledger on an older deployment

Deployments upgraded before `20261009_03_schema_migrations.sql` have no
ledger yet, and the runner refuses to guess what they contain. Run `baseline`
once with the last migration you applied, taken from your deployment records,
then apply the rest:

```bash
backend/scripts/migrate.sh baseline <last applied file>.sql
backend/scripts/migrate.sh up
```

`baseline` creates the ledger table if needed and records that file and every
file that sorts before it as applied, without running them. Choose the file
carefully: a migration recorded but never applied is skipped from then on.
Migrations are written for an expected starting schema, so do not try to
reach the same result by replaying the whole directory: a successful fresh
install from `schema.sql` is not evidence that an older database has
completed every upgrade step. The repository's schema-drift CI checks that a
pinned historical baseline, upgraded with `migrate.sh`, converges with a
fresh install.

Docker Compose needs none of this: its `db-init` service runs
`migrate.sh up` on every start, and adopts a volume created before the ledger
automatically on its first start.

If `baseline` was given a file that the database had not actually reached,
the files in between are recorded but were never run, and nothing reports it
until a later migration needs what they created. A migration that depends on
an earlier one in that way checks for it first and stops with the name of
the missing file, before changing anything:

```text
ERROR:  This database is missing objects from 20260917_02_memory_followup.sql
HINT:   Apply that file by hand ..., then run `migrate.sh up` again
```

Apply the named file with `psql` as the hint shows, then run
`migrate.sh up` again. To look for other gaps of the same kind, compare the
output of `backend/scripts/schema-fingerprint.sql` on the deployment with the
same script run against a database freshly installed from `schema.sql` at the
same commit; any line that differs is an object the deployment is missing or
has in an older form.

### After the organization-access upgrade: `tabular_review_legacy_shares`

`20260904_02_migrate_legacy_sharing.sql` converts the old roleless
`shared_with` arrays into real access grants. One shape has nowhere to go: a
tabular review that lives INSIDE a project now inherits access from that
project, so a share on the review alone cannot be reproduced without handing
the recipient the whole matter. That migration dropped
`tabular_reviews.shared_with` without recording those recipients.

`20260917_01_organization_access_followup.sql` creates
`public.tabular_review_legacy_shares` as the place those `(review, project,
email)` triples belong, and backfills it only if the `shared_with` column
still exists when it runs. On a deployment that already applied
`20260904_02` the column is gone, so the table lands EMPTY: the recipients
are recoverable only from a pre-upgrade backup. To recover them, restore the
old `shared_with` values into a scratch column named `shared_with` on
`tabular_reviews`, re-run `20260917_01` (it is safe to re-run), then drop the
scratch column. Fresh installs create the table empty and nothing writes it
at runtime. The table carries no foreign keys, so the record survives the
review or project being deleted. It is `service_role`-only; read it with the
service key:

```sql
select l.email, l.project_id, l.tabular_review_id, l.archived_at
from public.tabular_review_legacy_shares l
order by l.archived_at desc;
```

Each row is a person who could see that review before the upgrade and cannot
now. For each one, decide deliberately: grant them access to the project (or
add them to the organization) if they should still have it, and otherwise do
nothing. The table is a record, not a queue — nothing reads it, and rows may
be deleted once every recipient has been dealt with.

Apply the workflow catalog migration before deploying the matching backend
release, then run the dedicated ingestion job from the built backend artifact:

```bash
cd backend
npm run sync:workflows
```

The job resolves `MIKE_WORKFLOWS_REF`, downloads and validates the raw
catalog archive, uploads reference assets to the configured S3-compatible
storage, and transactionally replaces the active `mike_workflows` catalog.
Temporary archive and JSON files are deleted when the job exits. Run this as a
release job before directing traffic to the new backend; backend startup itself
only reads the database. Docker Compose runs this sequence automatically for
local/self-hosted deployments.

### Workflow catalog source and licences

With `MIKE_WORKFLOWS_REPOSITORY` and `MIKE_WORKFLOWS_REF` unset, the job syncs
the catalog pinned in `backend/src/lib/workflowCatalogPin.ts`: a repository
and a full 40-character commit, so every sync of a release reads the same
archive and makes no GitHub API call. Moving to a newer catalog release is a
one-line change to that file. To sync another catalog, set both variables; a
repository other than the pinned one has no default ref.

**Upgrade notes:**

- With `NODE_ENV=production` (the default in the backend image),
  `MIKE_WORKFLOWS_REF` must be a 40-character commit SHA. A branch or tag name
  such as `main` now fails the sync before anything is downloaded. Earlier
  versions of `backend/.env.example` set `MIKE_WORKFLOWS_REF=main`; if your
  `.env` still has that line, remove it to use the pinned catalog, or replace
  it with the commit you want.
- In Docker Compose, the `workflow-sync` service runs with the image's
  `NODE_ENV=production` unless your `.env` sets `NODE_ENV`, and the `backend`
  service starts only after that sync succeeds. A leftover
  `MIKE_WORKFLOWS_REF=main` therefore stops the backend from starting at all,
  even when the backend itself runs in development mode.
- The pinned commit can be older than the catalog's `main` branch. A
  deployment that synced `main` and then syncs the pin deactivates every
  add-on that exists only in the newer catalog: it leaves the add-on list,
  and copies people already imported keep working but report
  `catalog_status: withdrawn`. To stay on a newer catalog, pin it on purpose:
  find its commit with
  `git ls-remote https://github.com/<repository>.git refs/heads/main`, using
  the repository named in `workflowCatalogPin.ts`, then set
  `MIKE_WORKFLOWS_REF` to that SHA, or change the commit in
  `workflowCatalogPin.ts` so every deployment of a release syncs it.
- The asset rules below are new. A catalog of your own that ships other asset
  types, such as `.doc`, `.txt` or `.md` files in a workflow's `assets/`
  folder, now fails the sync; convert those files to an accepted type or
  remove them.

The sync refuses the whole catalog, naming the workflow, when a workflow:

- declares a licence other than `AGPL-3.0-only` (the deprecated `AGPL-3.0`
  is read as `-only`), `AGPL-3.0-or-later`, `Apache-2.0`, `CC-BY-4.0` or
  `MIT`;
- has no licence file. A workflow whose metadata says where its licence comes
  from (`license-evidence`) must carry its own `LICENSE`, `CHANGES.md` and
  `attribution` credit line; one without that metadata, such as the vendored
  defaults, may rely on a `LICENSE` at the root of the catalog;
- declares its licence only in a skill manifest (`license-evidence:
  manifest-only`) without `author-confirmation: "confirmed YYYY-MM-DD"`, or
  has `author-confirmation: "pending"`, while
  `MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES` is on. It is on unless set to
  `false` (or `0`, `no`, `off`), and should stay on for any catalog people
  rely on;
- has, anywhere under `assistant-workflows/` or `tabular-review-workflows/`,
  a tooling folder (`scripts/`, `bin/`, `tools/`, `hooks/`, `agents/`,
  `commands/`, `tests/`, `evals/`, `demo/`, `node_modules/`, `.github/` or
  `.claude-plugin/`); a script or source file (for example `.py`, `.sh`,
  `.js`, `.ts`, `.vbs` or `.ipynb`); an executable, library or installer
  (for example `.exe`, `.bin`, `.dll`, `.msi` or `.wasm`); markup that can
  carry script (`.html`, `.htm`, `.xhtml`, `.svg`, `.xml`, `.hta`); a
  macro-enabled Office file (`.docm`, `.dotm`, `.xlsm`, `.xltm`, `.xlam`,
  `.xla`, `.xlsb`, `.pptm`, `.potm`, `.ppam`, `.ppsm` or `.sldm`); a build or
  package file (such as `package.json`, `requirements*.txt`,
  `pyproject.toml`, a lockfile, `Makefile` or `Dockerfile`); a symlink; a
  file with an executable bit; or a name that ends in a dot or a space, which
  Windows drops (`run.py.` would arrive as `run.py`);
- has an asset (a file in its `assets/` folder) that is not a `.pdf`,
  `.docx`, `.xlsx` or `.pptx` file, whose content does not start the way its
  type does (an executable or a script under a document's name is refused),
  whose Office file contains macros, or whose name has a control character,
  a space at either end, or one of `<>:"|?*\`. The legacy `.doc`, `.xls` and
  `.ppt` formats are refused because their macros cannot be detected
  reliably;
- contains a path that leaves its folder (`..`, `.`, an absolute path or a
  backslash).

Each catalog row stores its licence, licence evidence, author confirmation,
credit line, provenance (catalog folder, licence file and upstream source),
`NOTICE` and `CHANGES.md`. These are part of a row's content hash, so the first
sync after this upgrade stores every workflow as a new row; earlier rows stay
readable for chat history. Imported add-ons and duplicated built-ins
(`POST /workflows/builtin-<key>/duplicate`, for the default workflows only)
keep the licence, credit and provenance read-only, and their detail reports
`catalog_status`: `current`, `update_available` when the catalog serves a
newer version, or `withdrawn` when the catalog no longer has the workflow.
Both copies run the same asset copy and rendering, so they share one rate
limit: `RATE_LIMIT_UPLOAD_MAX` requests (50 by default) per
`RATE_LIMIT_UPLOAD_WINDOW_HOURS` (1 by default).

## Document parsing resources

Indexing, chat reads, tabular sources, and legacy text precomputation share one
parser process per calling thread. It stays warm between files and recycles
after 200 files or 60 seconds idle, matching #721's worker reuse. Failures and
timeouts also retire it. On POSIX, retirement kills the process group, including
LibreOffice descendants, and removes its temporary directory.

Background jobs share one source-loading slot and wait at most 60 seconds total
for admission and parsing capacity; longer waits defer to Postgres for 30 seconds
without spending retries. Parsing is capped at five minutes, below the ten-minute
claim lease. Inline indexing waits for capacity when the queue runner is disabled.
Interactive requests can download three sources concurrently, matching tabular
row concurrency, and take priority over queued background parses. Background I/O
does not occupy the parser or the interactive admission queue (eight waiters).
Only parsing is serial; its deadline starts when parsing starts, as in #721.
Source downloads from S3-compatible storage abort after
`STORAGE_DOWNLOAD_TIMEOUT_MS` (default 120000), so a stalled read releases its
admission slot instead of holding it indefinitely.
Generic job concurrency does not create more parser slots.

Linux requires `prlimit` (util-linux), installed by Docker and Nixpacks. Missing
`prlimit` fails extraction. Defaults:

| Limit | Setting |
| --- | --- |
| Parser time | `EXTRACTION_TIMEOUT_MS=180000`, capped at 300000 |
| Writable data, including native buffers | `EXTRACTION_MAX_MEMORY_MB=1024` MiB |
| Virtual address space | Data budget + 1024 MiB for runtime reservations |
| Source / returned text | 150 MiB / 16 MiB |

The JS heap keeps the configured memory budget (1024 MiB by default); glibc uses two malloc arenas to
avoid excessive virtual reservations. OS limits apply **per process**, including
conversion children, not to their aggregate usage. Set container/cgroup limits
for the whole service. macOS/Windows retain heap, input/output and time bounds,
but lack the Linux OS-memory guarantee. Decompression is covered by parser
memory/time limits; there is no separate ZIP preflight.

The deadline covers parsing, not storage/database I/O. No new migration is
needed beyond #721's `20261027_01_document_text_failed_jobs.sql`.
`EXTRACTION_ISOLATION=off` bypasses subprocess protection for tests/emergencies.

## Environment

Copy the maintained examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Edit both files with the credentials and URLs for your deployment. At runtime,
the frontend server needs only `API_BASE_URL`; browsers call the same-origin
`/api` gateway and receive no Supabase URL, key, or session token. The variable
is not needed while building the frontend.

Use:

- `NODE_ENV=production` so startup enforces HTTPS and secure-cookie invariants
  (the backend Docker image sets this by default; see
  [Running the backend image](#running-the-backend-image));
- the Supabase project URL for backend `SUPABASE_URL`;
- the anon/publishable key for backend `SUPABASE_PUBLISHABLE_KEY`;
- the service-role key for backend `SUPABASE_SECRET_KEY`; and
- the internal Mike backend origin for frontend `API_BASE_URL`.

Set backend `API_PUBLIC_URL` to the browser-reachable frontend gateway, including
its `/api` prefix (for example, `https://app.example.com/api`). OAuth providers,
including MCP connectors, must return through that public gateway; never use an
internal container hostname such as `http://backend:3001` for callbacks.

Never expose Supabase session tokens, the service-role key, model-provider
keys, or storage secrets in frontend JavaScript.

Production web auth cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`,
and use the `__Host-` prefix. Word task-pane cookies additionally use
`SameSite=None` and `Partitioned` so an HTTPS pane embedded in Word on the web
can authenticate without exposing tokens to JavaScript. The add-in serves and
proxies `/api` from one origin; the backend still validates the original
`Origin` header. Terminate TLS at both public origins, and set `FRONTEND_URL`
plus `WORD_ADDIN_URL` to their exact values.

When `WORD_ADDIN_URL` is configured, also set a dedicated, high-entropy
`AUTH_HANDOFF_ENCRYPTION_SECRET`. Google OAuth transfers from its Office dialog
to the task pane using a request-bound, encrypted, single-use database ticket
that expires after two minutes. Apply
`20260825_01_auth_handoff_tickets.sql` before enabling this flow.

The first deployment intentionally signs out sessions created by older builds:
the web app deletes legacy Supabase local/session-storage entries and the Word
add-in deletes legacy OfficeRuntime access/refresh tokens. Users authenticate
once to establish the new cookie; tokens are not copied through JavaScript.

### Object-storage CORS for direct uploads

Mike's upload-session API gives an authenticated browser a short-lived signed
`PUT` URL for one specific staging object. The bucket must therefore allow
browser `PUT` requests from each deployed frontend origin. Configure the
equivalent of this CORS policy in Cloudflare R2, MinIO, RustFS, or the selected
S3-compatible provider:

```json
[
  {
    "AllowedOrigins": ["https://your-mike.example"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

List exact trusted origins; do not use `*` for a production deployment. The
signed URL authorizes only its generated object key and expires independently
of the CORS cache. The backend still verifies the uploaded byte count and
copies accepted bytes to a non-signed, sealed key before queuing processing.
Each file is verified and queued as soon as its individual `PUT` completes;
the remaining files in the same session may continue uploading while the
worker creates documents or document versions from earlier files. Success and
definite transfer failure are both reported through the file's idempotent
completion endpoint. The client retries that control request and then polls the
session, whose status is derived from its file rows; there is no separate
session-wide completion request.

Upload sessions accept at most 50 supported files, 100 MB per file, and 2 GB
in total. Users may run multiple independent upload sessions concurrently and,
by default, may create at most 50 sessions per hour. Upload-session mutation,
polling, and hourly creation limits can be overridden with the
`RATE_LIMIT_UPLOAD_SESSION_*` environment variables documented in
`backend/.env.example`; missing or invalid values use the documented defaults.
Sessions that update the same mutable document version remain mutually
exclusive. Sessions
expire after 30 minutes, extended by a further 30 minutes each time a file
completes so a slow batch is not destroyed mid-upload, up to four hours from
creation; individual signed URLs expire after 15 minutes and can
be refreshed while the session is pending. These limits are enforced atomically
in PostgreSQL, not only in the browser.

The Express process also runs a durable upload-processing pool. By default,
each backend replica claims up to 8 jobs concurrently while PostgreSQL limits
each user to two active jobs across all replicas. Override these defaults with
`UPLOAD_PROCESSING_CONCURRENCY` (capped at 64) and
`UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`; every claim loop polls the database,
so raising the pool raises idle query load in proportion. Workers claim jobs
with database leases, retry a failed file up to three times, and clean expired,
cancelled, and terminally failed temporary objects. A single document
conversion is killed after `UPLOAD_CONVERT_TIMEOUT_MS` (default 120000, clamped
to 10000-600000) and a worker stops renewing its lease after
`UPLOAD_JOB_WALL_CLOCK_MS` (default 900000, clamped to 60000-3600000) so a
wedged job is recovered by another worker instead of holding its slot. Terminal session metadata is retained
for seven days so clients can inspect outcomes, then deleted in bounded cleanup
batches.
Deployments must therefore run `backend/src/index.ts`
(the normal `npm start` entry point), rather than importing the Express app
without starting its worker.

Model-provider keys can be configured globally in `backend/.env` or per user
under **Settings > API Keys**. CourtListener tokens are never read from
`backend/.env`: each user saves their own under **Settings > Connectors**, or an
organization admin saves one for its members; see
[CourtListener](courtlistener.md). In a user's Personal workspace, a personal
key takes precedence over the matching globally configured key; removing the
personal key restores the global key as the fallback. Work in an organization
never uses personal keys: it runs on the organization's key for a provider,
and otherwise on the globally configured key.

### Rate limits and client addresses

The API rate-limits requests in lanes, each with its own window and cap
(`RATE_LIMIT_*` in `backend/.env.example`). Three things decide how a lane
behaves.

**What a budget belongs to.** Requests that call a model (chat, project chat
and Word chat turns, tabular review chat and generation, playbook reviews) and
starting a chat are limited per signed-in user, after authentication, with one
budget per user whichever workspace a request is for. People who share an
office address each get their own budget. Sign-in, MFA, email and public lanes
(the plan catalog a signed-out visitor reads at `GET /plans`,
`RATE_LIMIT_PLANS_PUBLIC_*`) are limited per client address; failed sign-ins
are also limited per account, keyed by a digest of the email address. The
public request form (`/request-forms`, reached without signing in) has two
such lanes: one for every request to a form, reading it included
(`RATE_LIMIT_REQUEST_FORM_MAX`, 30 per 15 minutes by default), and a tighter
one for submissions (`RATE_LIMIT_REQUEST_FORM_SUBMIT_MAX`, 10 per hour by
default); both answer before the form is looked up. The general lane and the
export, import, deletion, signed-upload and Word tool-result lanes are limited
per client address too, and upload sessions have their own per-user limits
(see above).

**Where the count lives.** The model, sign-in, MFA, email and public lanes
count in Postgres (the `rate_limit_windows` table, through the
`check_rate_limit` function), so a budget is the same on every API replica and
survives a deploy. Each row stores the lane name and a SHA-256 digest of what
the lane counts (a client address, a user id, or the digest of an email
address) instead of the value itself. That is pseudonymisation, not
anonymisation: anyone who can read the table can find the value behind a
digest by hashing candidates, such as every IPv4 address or the user ids and
email addresses in the database, so treat the rows as personal data. A row is
kept until its window ends and the next maintenance sweep deletes it. Every
other lane counts in process memory, so ordinary requests take no extra
database round trip. A single-process install can set `RATE_LIMIT_STORE=memory`
to keep every lane in memory; budgets are then per process and reset on
restart.

**What happens when Postgres cannot answer.** Model lanes let the request
through. Sign-in, MFA, email and public lanes refuse it with a 503, so
brute-force protection does not switch off while the database is slow. Both
cases are logged, and sent to error tracking when it is enabled.

Client addresses come from `X-Forwarded-For`. A browser can set that header
itself, so neither the web app's `/api` gateway nor the Word add-in host
passes on the value it receives. Configure the edge in front of them (CDN,
load balancer or platform router) to set the client's address in a header
that clients cannot override, and name that header in `CLIENT_IP_HEADER` on
the web app and on the add-in host, for example `cf-connecting-ip`,
`fly-client-ip` or `x-real-ip`. A reverse proxy you run yourself can set one:
with nginx, `proxy_set_header X-Real-IP $remote_addr;` and
`CLIENT_IP_HEADER=x-real-ip`. If the edge writes `X-Forwarded-For` itself,
appending the address it saw, `CLIENT_IP_HEADER=x-forwarded-for` uses the
right-most entry. Name only a header your edge always sets: a header it
passes through unchanged can be forged.

**Let only the edge reach the web app and the add-in host.** Once
`CLIENT_IP_HEADER` is set, the gateway and the add-in host forward whatever
address that header carries. Anyone who can connect to either of them without
passing through the edge can write the header and claim a new address on every
request, and so get a fresh sign-in, MFA, email and general budget each time:
the same bypass that "Keep the API private" below closes for the API. Set
`CLIENT_IP_HEADER` only when the web app and the add-in host accept
connections from that edge alone:

- With a reverse proxy on the same host, publish both on the loopback
  interface: `FRONTEND_PORT=127.0.0.1:3000` in the compose-root `.env`, and
  `-p 127.0.0.1:3200:3200` for the add-in host. Otherwise Docker publishes
  them on every interface, and a host firewall such as ufw does not filter
  ports that Docker publishes. A proxy that runs as a container on the Compose
  network reaches the web app without a published port, so you can remove the
  mapping instead. Outside Docker, block both ports from other machines with
  a firewall.
- With a CDN, let the origin accept only the CDN: allow just the CDN's
  published address ranges, require authenticated origin pulls, or connect
  the origin to the CDN through a tunnel. Remove or disable every other public
  address of the origin, such as the default URL a hosting platform assigns,
  because requests sent there skip the CDN.
- With a platform router, make sure that every public request reaches the
  service through it and that the service has no other public address.

Otherwise leave `CLIENT_IP_HEADER` unset. The web gateway then forwards no
client address and the API sees every browser at the gateway's own address,
so all users share each per-address budget. A production web app prints a
warning about this when it starts. The add-in host falls back to the address
of the connection it accepted, which is the edge's address when there is one.

**Keep the API private.** The per-address lanes are only as strong as the
API's network boundary. The API reads the client address from
`X-Forwarded-For` and, by default, trusts whatever connects to it to have
written that header honestly, as the gateway and the add-in host do. A caller
that can open a connection to the API itself can write the header and claim a
new address on every request, which gives it a fresh sign-in, MFA, email and
general budget each time. Make the API reachable only from the web app's
gateway and the add-in host: run it on a private network or an internal
service address, or let only those two connect, with a firewall or an
allowlist. Docker Compose publishes the API's port on every interface of the
host; on a server, remove that `ports` mapping or set
`BACKEND_PORT=127.0.0.1:3001` in the compose-root `.env` so that only the host
itself can connect. A host firewall such as ufw does not filter ports that
Docker publishes.

`TRUST_PROXY_HOPS` (default 1) is the number of proxies between the API and
the browser whose `X-Forwarded-For` entries the API trusts, counting the
gateway; at 0 it trusts none and uses the address of the connection itself.
Each load balancer between the gateway and the API that appends to
`X-Forwarded-For` adds one; without that, the API takes the load balancer's
view of the gateway as the client. Raise the setting above 1 only when the
API and those load balancers are private as described above: where others can
reach them, a value above 1 makes the API trust entries that the caller
wrote.

If the API has to stay reachable from the internet, for example because the
web app and the API run on different platforms, do not raise
`TRUST_PROXY_HOPS`. Keep it at 1 when the platform's router in front of the
API appends the connecting address to `X-Forwarded-For` or replaces the
header, and set it to 0 when nothing in front of the API writes that header;
either way a caller cannot choose the address the API sees. The per-address
lanes then count every request that comes through the gateway against the
gateway's own outgoing address, so all of its users share those budgets.

**Upgrading: breaking change.** Apply the migrations
(`backend/scripts/migrate.sh up`) before starting this version of the API.
Until the counters exist, the sign-in, MFA and email lanes answer 503 with
`schema_out_of_date`. The web gateway no longer passes on the
`X-Forwarded-For` header it receives. Set `CLIENT_IP_HEADER` on the web app,
and on the add-in host if you run it, as soon as only your edge can reach
them, as described above. Until you do, the API counts every browser against
the gateway's address: a few busy users can use up the general lane, and with
the default limits 30 failed sign-ins from anyone within 15 minutes block
sign-in for everybody until that window ends. Check that the API is private,
as described above, before you raise `TRUST_PROXY_HOPS`. Earlier versions read
`TRUST_PROXY_HOPS=0` as 1; it now trusts no proxy, so if you had set it,
check that it still matches what sits in front of the API.

### Error tracking

Error reporting is off by default: no runtime has a built-in destination,
and nothing is sent until you configure a DSN for your own Sentry project.
Once one is set, every runtime rebuilds reports from an explicit allowlist
before network transmission: code locations and line numbers, controlled
operation labels, HTTP method/status and normalized routes, validated
correlation IDs, release, and environment. Client document filenames,
document text, raw error and console messages, request
URLs/queries/headers/bodies, user identities, and
breadcrumbs are excluded. Automatic sessions, replay, attachments, traces,
and other non-error payloads are blocked. The same boundary applies to
community and official installations. See the [observability guide](observability.md)
for the exact policy, source-map behavior, and limitations.
To report, set the matching `*_SENTRY_DSN`. `SENTRY_DISABLED=true`
(`REACT_APP_SENTRY_DISABLED=true` for the add-in build) keeps reporting off
even with a DSN. The web image's `NEXT_PUBLIC_SENTRY_DISABLED` is a default
for the server and browser tunnel; an explicit runtime `SENTRY_DISABLED`
overrides it.

For the compose stack, set `SENTRY_DSN` (backend) and `FRONTEND_SENTRY_DSN`
(web app; the Next server forwards browser reports there at runtime) in the
root `.env`. `SENTRY_DISABLED=true` there switches both off again: the
backend reads it through `env_file`, and the Next server receives it from
compose and applies it to the browser's reports as well, which all pass
through it. Both work for the published images without a rebuild. What is
reported, what is scrubbed, and how to verify are in
[observability.md](observability.md).

## Authentication email

Supabase Auth sends signup, email-change, and password-recovery messages.
Configure production SMTP in the Supabase dashboard; Mike does not require a
Resend API key for these messages.

In **Authentication > URL Configuration**, set the Site URL to the deployed
frontend origin and add that origin's `/auth/callback` URL to the redirect
allow list. For example:

```text
https://your-mike.example/auth/callback
```

Enable email confirmation for production signups. Keep secure email change
enabled so Supabase requires confirmation from both the current and proposed
addresses. Set the minimum password length to 10; this applies when passwords
are created or changed and does not invalidate existing shorter passwords. The
same callback handles signup confirmation, confirmed email
changes, and password-recovery links before sending the user to the appropriate
Mike page.

Review the Supabase email templates after changing the public Site URL, and
test every link against the deployed frontend before inviting users. Existing
deployments must also apply the latest migration so confirmed email changes are
mirrored into `user_profiles`.

## Google authentication

Create a **Web application** OAuth client in Google Auth Platform. Its
authorized redirect URI is the Supabase Auth callback shown on the Google
provider page, not Mike's frontend callback. For hosted Supabase it normally
has this form:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Enable Google under **Supabase > Authentication > Providers**, then enter the
Google client ID and secret. In **Authentication > URL Configuration**, allow
both deployed Mike clients:

```text
https://your-mike.example/auth/callback
https://your-word-addin.example/oauth-dialog.html
```

The Word add-in completes authentication in an Office Dialog. The dialog gives
the task pane only an opaque, short-lived, single-use handoff ticket. The task
pane redeems it through the same-origin add-in proxy, and the backend writes its
HttpOnly cookie. No Supabase access or refresh token enters add-in JavaScript or
OfficeRuntime storage. The add-in also does not retain Google's provider access
token or request Google Drive or Gmail access.

## Enterprise SSO (SAML)

Self-hosted Mike can use SAML providers registered in Supabase Auth (GoTrue),
including Okta, Microsoft Entra ID, and Google Workspace SAML. The login page
offers an SSO entry point; the backend permits the flow only when SSO is
enabled. The existing email/password and Google methods remain available; this
feature does not enforce SSO-only access.

### Configure GoTrue

For the Compose GoTrue service, uncomment the SAML environment entries in
`docker-compose.yml`. Set `GOTRUE_SAML_ENABLED=true`, provide
`GOTRUE_SAML_PRIVATE_KEY`, and set `GOTRUE_SAML_EXTERNAL_URL` to the public Auth
base URL, for example `https://auth.example.com/auth/v1`. The `/auth/v1` suffix
is required behind the Compose gateway: GoTrue appends `/sso/saml/acs` and
`/sso/saml/metadata` to this base. Keep `SUPABASE_PUBLIC_URL` as the gateway
origin. Configure these values in the root Compose `.env` or shell environment;
`backend/.env` is loaded by the backend service, not the Auth service.

The pinned GoTrue version expects a standard base64-encoded **PKCS#1 DER RSA
private key** (at least 2048 bits), not PEM or PKCS#8. With OpenSSL 3:

```bash
umask 077
openssl genrsa -traditional -out saml-private.pem 2048
openssl rsa -in saml-private.pem -traditional -outform DER -out saml-private.der
openssl base64 -A -in saml-private.der -out saml-private.base64
```

Put the base64 file's contents in `GOTRUE_SAML_PRIVATE_KEY` using your deployment
secret store. Keep the key stable across restarts and replicas; rotating it
requires updating the IdP's trust configuration. Keep all key files outside the
repository. Restart the Auth service after configuring SAML.

In GoTrue, set `GOTRUE_SITE_URL` to the deployed frontend origin and restrict
`GOTRUE_URI_ALLOW_LIST` to the frontend's `/auth/callback` URL (plus existing
required callbacks). Replace the permissive local Compose allowlist for a
public deployment. For hosted Supabase, use its SAML provider setup and URL
configuration instead of configuring GoTrue container variables.

### Register an identity provider

Import the service provider metadata from:

```text
https://auth.example.com/auth/v1/sso/saml/metadata
```

Use its entity ID/audience and assertion consumer service (ACS) URL in your
IdP. The ACS is `https://auth.example.com/auth/v1/sso/saml/acs`, not Mike's
frontend callback. Configure the IdP to supply an email attribute and assign
the intended users or groups to the application.

For example, create a SAML 2.0 application in Okta, set its Single sign-on URL
to the ACS and Audience URI to the metadata entity ID, and add an `email`
attribute containing the user's email. Obtain the IdP metadata URL. Entra ID
enterprise applications and Google Workspace custom SAML applications use the
same service provider metadata; export their IdP metadata XML if they do not
provide a publicly fetchable HTTPS metadata URL.

Register the provider through GoTrue's admin API from a trusted administrative
machine. Replace these placeholders; the bearer token must be an administrative
`service_role` JWT, never a browser credential:

```bash
curl --fail-with-body --request POST \
  'https://auth.example.com/auth/v1/admin/sso/providers' \
  --header 'Authorization: Bearer <SERVICE_ROLE_JWT>' \
  --header 'apikey: <SERVICE_ROLE_JWT>' \
  --header 'Content-Type: application/json' \
  --data '{
    "type": "saml",
    "metadata_url": "https://idp.example.com/app/metadata",
    "domains": ["example.com"],
    "attribute_mapping": {"keys": {"email": {"name": "email"}}}
  }'
```

Use `metadata_xml` instead of `metadata_url` when importing XML. Match the
attribute mapping to the IdP's actual attribute name. The `domains` field maps
an exact domain to this provider; add all domains your users will enter. List
providers with `GET /auth/v1/admin/sso/providers`; use
`PUT /auth/v1/admin/sso/providers/<provider-id>` to update an existing provider
instead of repeating creation. Keep admin access restricted.

### Enable Mike and verify sign-in

Set these in `backend/.env` (or the backend service environment), then restart
the backend. No frontend rebuild is needed:

```dotenv
SSO_ENABLED=true
SSO_ALLOWED_DOMAINS=example.com
```

`SSO_ENABLED` defaults to false and enables only with `true` (case-insensitive).
The SSO screen asks for a company email and uses its normalized domain to find
the matching provider; the email itself is not sent to GoTrue during provider
discovery. `SSO_ALLOWED_DOMAINS` is an optional comma-separated list of exact
domains. Use DNS names, or punycode for international domains, without URLs or
wildcards. Invalid domain settings fail closed. Omitting the allowlist permits
any domain registered in GoTrue.
The allowlist controls Mike's sign-in initiation, not account authorization or
direct access to GoTrue; enforce membership and access policy at the IdP and
Auth service.

Mike calls GoTrue's `/sso` API using the server-side Supabase SDK, which sends
`skip_http_redirect: true` and a PKCE challenge. After IdP authentication,
GoTrue redirects to Mike's existing `/auth/callback`; the backend exchanges
the code using its HttpOnly verifier cookie and establishes the normal session.
Start sign-in from Mike in the same browser; IdP-initiated flows are outside
this integration. The Word add-in's existing authentication remains unchanged.

Before inviting users, verify the metadata contains the public ACS URL, try
both an assigned and an unassigned IdP user, confirm return to onboarding or
the app, and confirm logout and an unapproved domain behave as expected. SAML
identities can be separate accounts from existing email/Google identities; do
not assume matching emails link accounts or transfer project access.

Cloudflare Access or IAP in front of Mike is complementary perimeter access
control. It does not establish Mike's Supabase session and is not a substitute
for this SAML integration. Ensure the IdP/browser can reach the required SAML
endpoints through any perimeter controls.

References: [Supabase signInWithSSO](https://supabase.com/docs/reference/javascript/auth-signinwithsso),
[GoTrue SSO API](https://github.com/supabase/auth/blob/v2.189.0/internal/api/sso.go),
[SAML configuration](https://github.com/supabase/auth/blob/v2.189.0/internal/conf/saml.go),
and [provider administration](https://github.com/supabase/auth/blob/v2.189.0/internal/api/ssoadmin.go).

## Install and run

### Running the published images

Every push to `main` and every `v*` tag builds the backend and web-app images
once in CI and publishes them to GitHub Container Registry
(`.github/workflows/publish-images.yml`):

| Image | Tags |
| --- | --- |
| `ghcr.io/open-legal-products/mike-backend` | `<version>`, `latest` (releases); `<version>-dev.<run>`, `main` (every commit on main) |
| `ghcr.io/open-legal-products/mike-frontend` | same |

Pin a version in the compose-root `.env` and pull instead of building. The
default tag is the version in `/VERSION` of the checkout you run compose from,
so images and the database migrations they apply always belong together:

```bash
MIKE_IMAGE_TAG=2.1.0
docker compose pull
docker compose up --no-build -d
```

What you get that a local build does not: Sentry source maps for exactly
these bundles, so browser errors are readable, and the release
`mike@<version>+<sha12>` on every event (see
[observability.md](observability.md#releases)). `latest` and `main` are
convenience tags for trying things out; production deployments pin a version,
and a published version is never rebuilt (a fix is a new patch version).
`docker compose up --build` still builds from the checkout for development and
for anyone who patches the code; those images report as `mike@0.0.0...` unless
you pass `MIKE_VERSION` and `GIT_SHA`. The Word add-in image is not published:
its production build bakes in the deployment's web-app URL, so build it as
described under [Building the Word add-in image](#building-the-word-add-in-image).

`db-init` (schema and migrations) runs from the backend image rather than from
files in the checkout, so pulling a newer image and running `docker compose up`
applies that image's migrations. Forks publish to their own namespace: set
`MIKE_IMAGE_REPO=ghcr.io/<owner>` to run a fork's images. Only `linux/amd64`
is published; other architectures build from source. Disconnected sites can
`docker pull` by digest on a connected machine, `docker save`/`docker load`,
and run with `SENTRY_DISABLED=true`.

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
npm install --prefix word-addin
```

For development, start the packages in separate terminals:

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

For production, build both packages and run their `start` scripts through your
process manager or deployment platform:

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

If port 3001 (or `PORT`) is already taken, for example by the Docker Compose
backend, the backend reports the bind failure and exits instead of starting
without a listener.

### Running the backend image

The backend image sets `NODE_ENV=production`, so it refuses to start unless
`FRONTEND_URL` and `API_PUBLIC_URL` are set to `https` URLs (and
`WORD_ADDIN_URL`, when set, is too). That default is deliberate: an image
deployed without `NODE_ENV` must not quietly issue non-`Secure` cookies.
Docker Compose overrides it with `NODE_ENV=development` and local `http` URLs,
which is why `docker compose up` works without TLS.

The image contains no `.env` file. Pass the backend environment explicitly:

```bash
docker build -t mike-backend -f backend/Dockerfile .
docker run --rm -p 127.0.0.1:3001:3001 --env-file backend/.env \
  -e NODE_ENV=production \
  -e FRONTEND_URL=https://app.example.com \
  -e API_PUBLIC_URL=https://app.example.com/api \
  mike-backend
```

The example publishes the API on the host's loopback interface only. Wherever
you publish it, make sure that only the web app's gateway and the Word add-in
host can reach it (see
[Rate limits and client addresses](#rate-limits-and-client-addresses)).

To try the image on your own machine over plain `http`, pass
`-e NODE_ENV=development` with `http://localhost` URLs instead. When required
settings are missing, the fatal startup message lists each variable and
repeats this choice.

### Source offer (AGPL-3.0 section 13)

Every network user must be able to obtain the complete corresponding source of
the exact running version. Two things make that work in production, and boot
fails with a message naming the field if either is missing:

- `GIT_SHA` must be the full 40-character commit the image was built from
  (`GIT_SHA=$(git rev-parse HEAD)`), the same build argument the images already
  take. The running commit is shown on Settings > About and on the public
  `/source` page, which link to the repository at that commit.
- The source repository URL in the brand configuration
  (`packages/brand/brand.json`) must name the real public repository, not an
  `example.com`-style placeholder.

The backend serves the offer, unauthenticated, at `GET /source`: the licence,
the repository, the running commit and version, the upstream attribution, and
the workflow catalog repository with the commit its active rows were synced
from. Before building a release image,
`node scripts/agpl/check-release-commit.mjs` confirms the commit is on the
public remote, so the offer can always point at source that can be fetched. See
[UPSTREAM.md](../UPSTREAM.md) for how the fork tracks upstream and
[NOTICE.md](../NOTICE.md) for the modification and trademark notices.

### Building the Word add-in image

The repository includes Dockerfiles for the backend, frontend, and Word add-in.
The add-in image is not published (see "Running the published images"): its
production build bakes the deployment's public URLs into the static bundle, so
build it yourself, with its private backend origin supplied only at runtime.
Pass `MIKE_VERSION=$(cat VERSION)` and `GIT_SHA=$(git rev-parse HEAD)` as
build arguments too so its Sentry events carry the same release as the images
it runs beside ([observability.md](observability.md#releases)):

```bash
docker build -t mike-word-addin \
  --build-arg REACT_APP_WEB_APP_URL=https://app.example.com \
  --build-arg WORD_ADDIN_PUBLIC_URL=https://word.example.com \
  -f word-addin/Dockerfile .
docker run --rm -p 127.0.0.1:3200:3200 \
  -e WORD_ADDIN_BACKEND_ORIGIN=http://backend:3001 \
  mike-word-addin
```

Put an HTTPS ingress or reverse proxy in front of port 3200. The example
publishes the port on the host's loopback interface, for a reverse proxy on
the same host; with an ingress elsewhere, make sure that only the ingress can
reach the port. The included host serves `dist/` and streams `/api/*` to the
backend while preserving cookies, `Set-Cookie`, `Origin`, request bodies, and
SSE responses. When the ingress is the only way to reach the host, set
`CLIENT_IP_HEADER` on it to the header in which the ingress passes the
client's address. Otherwise leave it unset: the host then forwards the address
of the connection it accepted (see
[Rate limits and client addresses](#rate-limits-and-client-addresses)).

## Background jobs and Redis

Mike runs durable background jobs (document conversion, tabular extraction,
audit recording, account deletion, storage cleanup, export builds) through one
of two interchangeable transports:

- **With Redis** (`REDIS_URL` set): jobs are delivered instantly through
  BullMQ, and tabular reviews stream live progress over Redis pub/sub. The
  bundled Docker Compose stack ships a Redis service and enables this by
  default for new installs.
- **Without Redis**: the same jobs run through a Postgres-backed queue
  (`db_jobs`, created by the schema/migrations) with a polling worker. No
  extra infrastructure is required — an existing deployment that upgrades in
  place keeps working with no configuration changes and no Redis. Progress
  streaming falls back to short database polls.

The transport is selected automatically; `QUEUE_DRIVER=postgres` forces the
database queue even when `REDIS_URL` is set.

By default, workers run in a worker thread inside the backend process, so no
extra process management is needed. To run them on separate hardware, start
`node dist/worker.js` (any number of instances — work is partitioned safely)
and set `WORKERS_MODE=none` on the API process. The compose file contains a
commented `worker` service demonstrating this.

### Document lifecycle migration

Apply `20260914_01_document_lifecycle.sql` before deploying the backend that uses
its version RPCs. Fresh installs include it in `backend/schema.sql`;
`backend/scripts/migrate.sh up` and Compose's `db-init` service apply it
during upgrades. Do not remove pending
`document.cleanup` jobs: they retain the object keys needed to finish erasure.
The migration makes both queue claim paths recover failed cleanup jobs, including
ones rejected by an older worker during rollout, and exhausted stale claims.
Keep failed cleanup rows as well as pending ones; upgraded workers reclaim them.

Backend and frontend Docker build contexts are now the repository root, so both
can compile against `packages/contracts`. For a manual backend image build use
`docker build -f backend/Dockerfile -t mike-backend .` from the root.

Each image reads only what its Dockerfile copies: the frontend image contains
`frontend/` and `packages/contracts`; the add-in image adds `frontend/src/shared`
and `frontend/public/icons`, which its bundle includes. In the frontend image
`next build` type-checks `frontend/tsconfig.build.json`, which excludes test
files, so test fixtures and sibling applications never become build inputs. CI builds all three
images on every pull request (`.github/workflows/docker-images.yml`), so a
source change that reaches outside a build context fails before merge instead
of on the next fresh install.

## AI usage, the deployment-key cap and the cost report

Every model call is recorded in `usage_events`, one row per call: the
workspace (an organization, or the person's Personal workspace), the person,
the matter when there is one, the surface (chat, project chat, Word, tabular
review, playbook, title, subagent or memory curation), the model and provider,
whose key it ran on, the input, output and cached tokens, and the document
pages when they are known. No prompt or answer text is stored. The key source
is `user` for a key the person saved, `org` for their organization's key, and
`env` for the deployment's own: the provider keys in this environment, keys
written into `MIKE_MODEL_CONFIG_JSON`, and endpoints served without a key
(Ollama, keyless configured models). Rows go with their organization; Personal
rows go with the account. When an account or a matter is deleted, a team
organization keeps its rows and only the link to them is cleared. A person's rows are
included in their data export. Apply `20261031_56_usage_events.sql` (Compose's
`db-init` and `backend/scripts/migrate.sh up` do) before relying on the
ledger: until it runs, calls go ahead and the server log reports once that
rows cannot be written.

A call's tokens are the counts its provider reports for each model request
it makes, including a request that pauses for an approval or for the
person's input. A request that is stopped, or cut off by a deadline or a
provider failure, after its answer had started streaming, and a request to a
provider that reports no counts, are recorded with an estimate instead: about
four characters a token of the text sent and received, with
`tokens_estimated` set on the row. Text in attached files is not part of an
estimate. A request stopped before any of its answer arrived is not recorded,
although the provider may still bill its input.

Set `DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP` to limit how many input plus output
tokens may be used on the deployment's own keys in a calendar month (UTC). The
cap is counted twice: for each workspace, over all its members, and for each
person, over every workspace they work in. Anyone signed in can create an
organization, and a new organization starts with nothing used, so the
person's own total is what keeps the cap a limit on what one account can
spend. Leave it unset for no cap, as before the ledger existed; `0` turns the
deployment's keys off. Once either total this month has reached the cap, the
next request that would run on a deployment key is refused before any
provider call with the code `deployment_quota_exceeded`: JSON endpoints answer
403, and streamed answers end with an error event carrying the same code and
a message that says how to continue (save a provider key in Settings → Bring
Your Own Keys, have an organization admin add the organization's key, or ask
the administrator). A tabular review stops starting rows once one is refused,
and background work (row extraction jobs, memory curation) is not retried on
a refusal. Keys people and organizations save are recorded but never capped.
A value that is not a whole number of tokens refuses deployment-key calls
until it is fixed, and the server log names the variable. If the ledger
cannot be read, the call goes ahead and the failure is logged.

The cap is a limit per workspace and per account, not a spending limit for
the deployment: it cannot stop one person from opening several accounts, and
it is checked before a call, so calls already running when it is reached
finish. Each backend process reuses a total it has read from the ledger for
up to 30 seconds per workspace and person, adding its own calls as they
finish, so calls running in other processes can go over the cap by what they
use in that time. Keep the provider's own spending limits on the deployment's
keys.

`npm run report:usage --prefix backend` prints tokens and estimated cost per
run, per document and per page for one month. It runs the compiled job, so
build first, as for `sync:workflows`:

```bash
npm run build --prefix backend
npm run report:usage --prefix backend -- --month 2026-10 --org <organization uuid>
```

`--project <uuid>` narrows it to one matter and `--json` prints the report as
JSON (run it as `npm run --silent report:usage ...` to pipe it, so npm's own
banner stays out of the output); `--help` lists the options. Prices come from `USAGE_PRICE_TABLE_JSON`,
in your currency per million tokens, for example
`{"currency":"USD","models":{"model-id":{"input":1.0,"output":2.0,"cached_input":0.1}}}`.
A model id ending in `*` prices every id that starts with it. Keep the table in
the deployment's environment rather than in source control. Without it the
command exits with status 1 and names the variable. Every cost it prints is an
estimate, recorded tokens times your prices; the provider's invoice is the
authority. The report also says how many calls have estimated tokens.

## Plans, seats and trials

Plans are off by default. With `PLANS_ENABLED` unset, every workspace is
entitled and has no seat limit, exactly as before plans existed, so a
self-hosted deployment sees no change. Billing is a separate switch and stays
off; nothing here charges anyone. Turn plans on only together with a catalog.

`PLANS_CATALOG_JSON` holds the plans this deployment offers, as a JSON array.
No plans or prices are kept in source control; supply your own. It is validated
at startup, and a malformed catalog stops the process and names the field at
fault. Each plan has:

- `key` (required) and `name` (required);
- `description`;
- `seat_limit`: a whole number of seats, or `null` for no limit;
- `features`: an array of short strings;
- `deployment_token_allowance`: the monthly tokens a workspace on this plan may
  use on the deployment's own AI keys, or `null` to fall back to
  `DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP`;
- `trial_days`;
- `public`: whether the plan is shown to buyers at `GET /plans` (default true);
- `sort_order`;
- `display_price_text`: the price as shown to a buyer;
- `provider_price_ref`: the billing provider's price id, never returned to a
  browser.

Every organization — team workspaces and the hidden Personal workspace alike —
gets an `org_subscriptions` row when it is created, with a trialing status and
a default trial window. When plans are enabled:

- an invitation is refused with `seat_limit_reached` once members plus open
  invitations reach the effective seat limit (the plan's, or an override on the
  subscription row);
- accepting an invitation takes a seat atomically, so two people accepting the
  last seat at once cannot both get in;
- a plan's `deployment_token_allowance` feeds the deployment-key cap above, in
  place of `DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP`, for that workspace;
- an expired trial, or a past-due or canceled subscription, blocks only
  hosted-model use (calls on the deployment's keys); a person's own key, data
  export and account or organization deletion are never blocked.

Owners and admins see a workspace's plan, seats and this month's usage under
Settings → Plan and usage (`GET /orgs/:id/plan`); the personal settings Usage
Plan card shows the same for a person's own workspace. There is no upgrade
control while billing is off. Billing is its own switch, `BILLING_ENABLED`
(default off), with a test-mode-only provider adapter behind it; see
[Billing](billing.md) for the switches, the checkout and portal routes, and
what each provider event does to a subscription.

**Upgrading.** Apply `20261107_50_org_subscriptions.sql` (Compose's `db-init`
runs it). It is additive and safe to re-run. The trigger creates a
subscription row only for organizations created after it runs; organizations
that already exist keep no row, which reads as no plan — unlimited and
unblocked, the same as leaving plans off. Leave `PLANS_ENABLED` unset to keep
today's behaviour.

## Public site

The web app serves a small public site for visitors who are not signed in:
the home page at `/`, `/pricing`, `/docs` (an index and four pages: getting
started; tabular review and quote status; data and privacy; source code and
licences), and `/security`. The copy lives in
`frontend/src/content/site/` and `frontend/src/content/docs/`, where the
content lint (`frontend/src/content/__tests__/contentLint.test.ts`) checks
it, and every name, address and document link comes from the brand
configuration.

Two switches control it. Both are `NEXT_PUBLIC_*` variables, which `next
build` inlines into the bundle, so **changing either one means rebuilding the
web app** (`docker compose build frontend` with the matching build argument,
or a new image). A runtime environment change does nothing.

- `NEXT_PUBLIC_SITE_ENABLED=true` shows the home page at `/` to a signed-out
  visitor. Unset, `/` keeps redirecting to the app, as it always did. A browser
  that carries a session cookie goes to the app either way; the pricing,
  documentation and security pages exist either way.
- `NEXT_PUBLIC_SITE_INDEXABLE=true` lets search engines index the public
  pages. Unset, `/robots.txt` disallows all crawling and every page response
  carries `X-Robots-Tag: noindex, nofollow`, so a preview or a self-hosted
  install stays out of search results. Draft legal documents and the security
  page while its status is draft stay `noindex` even on an indexable site.

`/pricing` reads the public plans from `GET /plans`, which answers without a
session and returns only the plans marked public, their display price text and
no provider reference (see [Plans, seats and trials](#plans-seats-and-trials)).
Like every anonymous route it has its own per-address lane in the shared
rate-limit store (`RATE_LIMIT_PLANS_PUBLIC_MAX`, default 120 requests per
`RATE_LIMIT_PLANS_PUBLIC_WINDOW_MINUTES`, default 15; see [Rate limits and
client addresses](#rate-limits-and-client-addresses)), so the pricing page
reports a failed load while the database cannot count requests. With no plans
configured it says "Pricing is not available yet." Nothing can be bought
there: billing stays off, and the page offers only the account and sign-in
links.

`/security` states what the software does, filled from the brand
configuration and from `frontend/src/content/site/securityFacts.ts`, where an
operator records independent assessments once there are any; until then the
page says that none exists. `/.well-known/security.txt` is generated on each
request from `brand.securityEmail`, with an `Expires` field 180 days ahead.

Every page route (everything but the `/api` gateway and the `/monitoring`
tunnel) carries these response headers, set in `frontend/next.config.ts` from
`frontend/src/app/lib/securityHeaders.ts`:

- `Content-Security-Policy: frame-ancestors 'self'`, enforced: no other
  origin may frame the app. The Word add-in signs in through a separate
  dialog window, never a frame.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(),
  microphone=(), geolocation=()`.
- `Content-Security-Policy-Report-Only`, a full policy that browsers only
  log. It has no reporting endpoint; it records what an enforced policy would
  have to allow before one is switched on.
- `X-Robots-Tag: noindex, nofollow` while the site is not indexable.

The API's own responses keep the headers the API sets.

## Deployment safety

- Generate unique, high-entropy signing and encryption secrets.
- Use production Supabase credentials rather than the local demo values.
- Keep backend secrets out of `NEXT_PUBLIC_*` variables.
- Let only the web app's gateway and the Word add-in host reach the API.
- Set `CLIENT_IP_HEADER` on the web app and the add-in host only when nothing
  but the edge that writes that header can connect to them, for example both
  published on loopback behind a reverse proxy on the same host, or an origin
  that accepts only the CDN. Otherwise leave it unset. See
  [Rate limits and client addresses](#rate-limits-and-client-addresses).
- Configure spending limits for model-provider keys where supported, and set
  `DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP` when people without their own key use the
  deployment's (see [AI usage](#ai-usage-the-deployment-key-cap-and-the-cost-report)).
  The cap limits each workspace and each account; it does not replace the
  provider's limits, because it cannot limit how many accounts are opened.
- Confirm LibreOffice is available to the backend and worker if document
  conversion is enabled. The backend Docker image and `backend/nixpacks.toml`
  install it; elsewhere the backend looks on `PATH`, in the usual Linux
  locations, and in `/Applications/LibreOffice.app` on macOS. Set
  `SOFFICE_BINARY_PATH` to the `soffice` executable for any other location.
  Without it, Word and presentation uploads are kept without a PDF rendition
  and the worker logs `conversion_unavailable` once per upload.
- Confirm the backend can reach the object store with the configured `R2_*`
  credentials before accepting uploads. When it cannot, completing an upload
  answers 503 and the server log names the failing storage operation and the
  store's own error (for example `ECONNREFUSED`, `InvalidAccessKeyId`, or
  `NoSuchBucket`); clean-up deletes of temporary upload objects are reported
  once per upload as warnings.
- Review storage, logging, retention, and deletion behavior before processing
  confidential documents.

See [Safe local testing](safe-local-testing.md), the [security policy](../SECURITY.md),
and [Troubleshooting](troubleshooting.md) for related guidance.
