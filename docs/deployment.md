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
`Open-Legal-Products/mike-workflows` archive, uploads reference assets to the
configured S3-compatible storage, and transactionally replaces the active
`mike_workflows` catalog. Temporary archive and JSON files are deleted when the
job exits. Run this as a release job before directing traffic to the new
backend; backend startup itself only reads the database. Docker Compose runs
this sequence automatically for local/self-hosted deployments.

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
are limited per client address; failed sign-ins are also limited per account,
keyed by a digest of the email address. The general lane and the export,
import, deletion, signed-upload and Word tool-result lanes are limited per
client address too, and upload sessions have their own per-user limits (see
above).

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

Error reports are sent to the Mike project's own Sentry by default, so the
maintainers can fix failures encountered by forks and self-hosted installs.
Before network transmission, every runtime rebuilds reports from an explicit
allowlist: code locations and line numbers, controlled operation labels,
HTTP method/status and normalized routes, validated correlation IDs, release,
and environment. Client document filenames, document text, raw error and
console messages, request URLs/queries/headers/bodies, user identities, and
breadcrumbs are excluded. Automatic sessions, replay, attachments, traces,
and other non-error payloads are blocked. The same boundary applies to
community and official installations. See the [observability guide](observability.md)
for the exact policy, source-map behavior, and limitations.
To opt out, set `SENTRY_DISABLED=true`
(`REACT_APP_SENTRY_DISABLED=true` for the add-in build). The web image's
`NEXT_PUBLIC_SENTRY_DISABLED` is a default for the server and browser tunnel;
an explicit runtime `SENTRY_DISABLED` overrides it. To use your own Sentry
instead, set the matching `*_SENTRY_DSN`.

For the compose stack that is `SENTRY_DISABLED=true` in the root `.env`
(the backend reads it through `env_file`; the Next server receives it from
compose and applies it to the browser's reports as well, which all pass
through it). It therefore works for the published images without a rebuild.
To report to your own Sentry instead, set `SENTRY_DSN` (backend) and
`FRONTEND_SENTRY_DSN` (web app; the Next server forwards browser reports
there at runtime). What is reported, what is scrubbed, and how to verify are
in [observability.md](observability.md).

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
- Configure spending limits for model-provider keys where supported.
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
