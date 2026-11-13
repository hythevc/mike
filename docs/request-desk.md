<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Request desk

The request desk is an organization's queue of legal requests. Each request
gets a reference that is numbered per organization (`REQ-1`, `REQ-2`, ...),
a status, a priority, an optional due date and an assignee, and can be turned
into a matter. It exists only in team organizations: the Personal workspace
has none.

The backend lives in `backend/src/modules/intake/`, mounted at `/intake`. No
model call runs anywhere in it.

## Who can do what

Standing is decided per request and returned on every request as
`access_role`:

| Role | Who | Can |
| --- | --- | --- |
| `owner` | The organization's owners and admins | Everything below, on every request |
| `editor` | The request's assignee, and the member who logged it | Edit its details, change its status, assign it, create its matter |
| `viewer` | Every other member | Read it, comment on it, and take it while it is open and unassigned |

Only current members of the organization can see its requests: anyone else
gets `404`, so request ids cannot be probed. Only current members can be
assigned one; naming anyone else is refused with
`request_desk_assignee_not_member`.

## Statuses

`new`, `in_progress` and `waiting` are open; `closed` and `declined` are
terminal. `closed_at` is set when a request enters a terminal status, kept if
it moves between the two, and cleared when it is reopened. A request is
overdue while it is open and its `sla_due_at` has passed. A due date given as
a calendar date (`2026-11-05`) means the end of that day, UTC.

Every status change writes one `status_change` entry in the request's
activity trail (with the optional note) and one audit row. Moving a request
to the status it already has writes nothing.

## API

| Method and path | Does |
| --- | --- |
| `GET /intake/requests?workspace=<org id>` | One page of the organization's requests |
| `POST /intake/requests` | Log a request. Body: `org_id`, `title`, and optionally `details`, `request_type`, `priority`, `requester_name`, `requester_email`, `sla_due_at`, `assignee_email` |
| `GET /intake/board?workspace=<org id>` | Counts for the triage board: total, open, overdue, unassigned, assigned to the caller, per status, open per priority |
| `GET /intake/requests/:requestId` | One request |
| `PATCH /intake/requests/:requestId` | Edit its details (the same optional fields as logging) |
| `POST /intake/requests/:requestId/status` | `{ status, note?, expected_status? }` |
| `PUT /intake/requests/:requestId/assignee` | `{ assignee_email }`, or `null` to unassign |
| `GET /intake/requests/:requestId/comments` | Its activity trail, oldest first |
| `POST /intake/requests/:requestId/comments` | `{ body }` |
| `POST /intake/requests/:requestId/matter` | Create a matter from it: `{ name?, cm_number?, practice?, visibility? }` |

List filters: `status` (comma-separated, or `open`), `priority`
(comma-separated), `assignee` (`me`, `none` or a user id), `overdue=true`,
`due_before`, `sort_key` (`created`, `updated`, `due`, `priority`,
`reference`), `sort_direction`, `limit` and `offset`.

Wire types are in `packages/contracts/index.d.ts` (`RequestDesk*`).

Codes a client acts on, all listed in `CODE_KINDS`:

| Code | Status | Meaning |
| --- | --- | --- |
| `request_desk_org_only` | 400 | The Personal workspace, or no workspace, was named |
| `request_desk_assignee_not_member` | 400 | The assignee is not a current member |
| `request_desk_status_conflict` | 409 | `expected_status` no longer holds |
| `request_desk_assignee_taken` | 409 | A colleague took the request first |
| `request_desk_matter_linked` | 409 | A matter was already created from the request |

## Matters

Creating a matter goes through the projects module, so the matter is an
ordinary project in the request's organization. The person who creates it
owns it, and it is private unless they open it to the organization. The
request shows the matter's name only to people who can open the matter;
everyone else sees that one exists.

### Jurisdiction profile

Every project, whether or not it came from a request, can record which law
its work is about. The profile is three optional fields on the project:

| Field | Holds |
| --- | --- |
| `jurisdictions` | Up to 10 codes from the jurisdiction registry, in the order they were chosen |
| `governing_law` | One registry code |
| `working_language` | One tag from the response-language list in `backend/src/lib/responseLanguages.ts`. `auto` is not a working language |

A code is two capital letters for a country (`GB`), with a suffix for a
subdivision (`US_CA`). `EU` stands for the European Union and `ZZ` for
international standards, which belong to no single state. The registry is
`backend/src/lib/jurisdictions.ts`; the rules for a valid profile, shared by
the projects module, the orgs module and the chat engine, are in
`backend/src/lib/jurisdictionProfile.ts`.

| Method and path | Does |
| --- | --- |
| `GET /projects/jurisdictions` | The registry for pickers, for any signed-in user: each jurisdiction's `code`, `name`, `kind`, `parent` and `languages`, the working languages, and the limit of 10 |
| `POST /projects`, `PATCH /projects/:projectId` | Accept the three fields. In a `PATCH`, a field left out is unchanged, and `[]` or `null` clears it |
| `GET /orgs/:orgId/matter-defaults` | The organization's `default_jurisdictions` and `default_working_language`, for any member |
| `PUT /orgs/:orgId/matter-defaults` | Set either default. Owners and admins only; another member gets `403` |

Every read of a project returns the three fields, and a project with nothing
recorded returns an empty list and two nulls. Changing a project's profile
needs the owner role on the project, as its other settings do. A value
outside the registry or the language list is refused with `400` and one of
these codes, all listed in `CODE_KINDS`:

| Code | Meaning |
| --- | --- |
| `invalid_jurisdiction` | A jurisdiction or governing law that is not a registry code |
| `too_many_jurisdictions` | More than 10 jurisdictions |
| `invalid_working_language` | A working language that is not on the response-language list |

A project created in an organization takes the organization's default for
each field its request leaves out. A field that is sent, even empty, is kept
as sent. A matter created from a request is created the same way, so it
starts with the defaults too. Changing the defaults leaves existing projects
as they are.

When a chat runs inside a project, the model is given the matter's
jurisdictions (as `Name (CODE)`), governing law and working language as
facts, beside the user's own jurisdiction. They say which law the matter is
about. They do not check an answer: what the assistant writes is still a
draft for a lawyer to verify.

In the web app the three fields are in a project's Details, next to its
practice, and the chosen jurisdictions show under the project's header. An
organization's owners and admins set the defaults under the organization's
General settings.

A change writes one audit row with ids and codes only:
`project.jurisdiction_profile.updated` (surface `project`) or
`org.matter_defaults.updated` (surface `organization`), naming the fields
that changed and their new values. A request that repeats what is stored
writes nothing.

Migration `backend/migrations/20261113_50_matter_jurisdiction.sql` adds the
three columns to `projects` and the two to `organizations`, with the limit of
10 on both lists and a format check on `governing_law`. Existing deployments
must apply it; fresh installations get the columns from `backend/schema.sql`.

Tests: `backend/src/lib/__tests__/jurisdictions.test.ts` and
`jurisdictionProfile.test.ts` (the registry and the rules),
`backend/src/__tests__/integration/matterJurisdiction.routes.test.ts` (the
HTTP layer, defaults and tenant isolation),
`backend/src/__tests__/integration/matterJurisdiction.postgres.test.ts` (the
migration in real PostgreSQL, under `npm run test:stack --prefix backend`),
and `backend/src/modules/chat/engine/__tests__/matterPersonalisationPrompt.test.ts`
(what the model is told).

## Data

Migration `backend/migrations/20261031_53_request_desk.sql` adds:

- `request_desk_requests`, `request_desk_comments` (the activity trail) and
  `request_desk_counters` (the last reference number, per organization);
- `request_desk_create_request`, `request_desk_change_status`,
  `request_desk_assign` and `request_desk_link_matter`, security-definer
  functions that each write their change and its trail entry in one
  transaction, and `request_desk_board_summary`;
- a guard trigger that keeps a request in its organization, requires an
  active team organization for new requests, a member as assignee and a
  matter from the same organization.

Every table enables RLS and revokes everything from `anon` and
`authenticated`; `service_role` may read requests and edit their details, and
read and add comments.

Migration `backend/migrations/20261108_50_request_desk_forms.sql` adds
`request_desk_forms` (one row per form, holding the SHA-256 digest of its link
token, never the token), `request_desk_requests.form_id`, and two
security-definer functions: `request_desk_submit_form_request`, which files a
public submission through `request_desk_create_request` with source `form`
and no creator, and `request_desk_delete_expired_form_submissions`, the
retention sweep. `service_role` may read, insert and update forms and still
holds no `DELETE` on requests.

Deleting an account keeps the organization's requests and trail and clears
the links to that person. Deleting a project clears the link to it. Purging
an organization deletes its requests, trail and counter.

## Request forms

A request form is a link an organization hands to people without a seat, such
as a client's team or business colleagues. Whoever opens the link sees the
organization's name and logo, its notices and a short form, and gets back a
reference and nothing else. No model call runs inside a submission, and a
requester never sees AI output: lawyers pick the request up on the board,
where it carries `source: "form"` and no creator, and reply outside the
product.

Owners and admins manage forms at `/intake/forms` (reached from the board's
"Request forms" link). Creating a form, or replacing its link, shows the link
once: the token is random, stored only as a SHA-256 digest, and never shown
again. A form carries, in the organization's own wording, a title, an
introduction, a disclaimer (that submitting does not create a lawyer-client
relationship and that a person replies) and a privacy notice (that the
organization controls the data entered), with a link to the organization's
privacy policy, the email domains it accepts senders from (empty: any
address), and how long a submission is kept. The notices can be reworded but
not removed. The public page adds the product's own line that no AI-generated
advice is shown and a person replies, and says how long the submission is
kept.

| Method and path | Does |
| --- | --- |
| `GET /intake/forms?workspace=<org id>` | The organization's forms, without tokens |
| `POST /intake/forms` | Create a form (`org_id`, and optionally `title`, `intro`, `disclaimer`, `privacy_notice`, `privacy_policy_url`, `allowed_sender_domains`, `retention_days`); answers with the form, its `token` and its `path` |
| `PATCH /intake/forms/:formId` | Edit the same fields, or `enabled` |
| `POST /intake/forms/:formId/rotate` | Replace the link; answers with the new token once |
| `GET /request-forms/:token` | Public: what the form shows (organization name and logo, notices, retention) |
| `POST /request-forms/:token/submit` | Public: `{ title, details, requester_name, requester_email }`; answers `{ reference }` |

The public routes take no session. They sit behind two rate-limit lanes in
the shared store that run before any lookup (see `docs/deployment.md`,
"Rate limits and client addresses"), and a 64 KB body cap. An unknown,
malformed, disabled or replaced token is answered with one identical
`404 request_form_not_found`, so a link cannot be probed for its state. A
hidden field (`website`) that a person never sees is a honeypot: a submission
that fills it is told it succeeded and writes nothing. Every field has a
length cap (title 200, details 10,000, name 200, email 320), and a sender
outside the approved domains is refused with `request_form_sender_not_allowed`
without the domains being disclosed. Management is refused to members with
`request_form_admin_only`; all three codes are in `CODE_KINDS`.

Retention: `request_desk_delete_expired_form_submissions` deletes form
submissions that were not turned into a matter once they are older than their
form's `retention_days` (365 for a submission whose form is gone), comments
included; converted submissions stay with their matter. `jobs/maintenance.ts`
runs it on the maintenance interval through `deleteExpiredFormSubmissions`.

The web app serves a form at `/request/<token>`, a public route prefix the
onboarding and MFA gates let through. The page shows the organization's name
and logo, the notices, the form, and after a submission the reference with a
reminder to keep it, since replies happen outside the product until an email
provider is approved; it carries the signed-out footer with the Source, Terms
and Privacy links and is excluded from search engines.

## Audit and export

Each action records one audit row with surface `intake` and ids only:
`request.created`, `request.updated`, `request.status_changed`,
`request.assigned`, `request.unassigned`, `request.commented` and
`request.matter_created`. Titles, details, requester data, notes and
comments never reach the audit log.

Request forms add `request.form_created`, `request.form_updated`,
`request.form_enabled`, `request.form_disabled`, `request.form_link_rotated`
(ids only: the form) and `request.form_submitted` (the form and the request).
A submission has no signed-in actor, so its row carries no user and the
organization's audit log shows the actor as "Requester (form)".

An organization's account export (Settings > Privacy & Data) includes the
requests the person logged or is assigned, and the trail entries they wrote,
under `request_desk`.

## Board (web app)

The web app shows the request desk at `/intake`, reached from the Intake item
in the sidebar's primary navigation. That item, and the page, appear only in
an organization workspace; in the Personal workspace the page explains that
the request desk belongs to an organization. The organization-only flag lives
on the `NavItem` shape in `frontend/src/app/components/shared/navItems.ts`.

The board (`frontend/src/app/components/intake/`) lists an organization's
requests grouped by status, with filters for status, priority, assignee and
SLA due date and sorting by reference, priority or due date. Priority, status
and the overdue flag are plain text, never colour alone. A side panel holds a
request's details, its activity trail, assignment, status changes and the
"Create matter" action with the resulting matter link; a typed comment is kept
if a save fails. A "New request" modal captures a request inside the app.
Skeleton, empty, filtered-empty and error states all match the table layout,
and every failure is shown through `notifyError`. The client calls live in
`frontend/src/app/lib/mikeApi.ts` and read `request_desk_*` codes through
`describeError`.

## Tests

- `backend/src/modules/intake/__tests__/`: service tests over an in-memory
  fake of the tables and functions.
- `backend/src/__tests__/integration/intake.routes.test.ts`: the HTTP layer.
- `backend/src/__tests__/integration/requestDesk.postgres.test.ts`: the SQL
  in real PostgreSQL, including 50 concurrent creates. It runs under
  `npm run test:stack --prefix backend`, or against any disposable server:

  ```bash
  MIKE_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres \
    npm test --prefix backend -- src/__tests__/integration/requestDesk.postgres.test.ts
  ```

  It creates and drops its own database.
- `frontend/src/app/components/intake/`: component tests for the board's
  grouping and states and for the side panel's assign, status, comment and
  matter actions, and `frontend/src/app/components/shared/navItems.test.ts`
  for the organization-only Intake item.
- `e2e/intake.spec.ts`: an org admin logs, assigns, progresses and converts a
  request, and the board passes the shared axe check.
- Request forms: `backend/src/modules/intake/__tests__/intake.forms.test.ts`
  (tokens, parsers, the allowlist and the retention sweep over the fake),
  `backend/src/__tests__/integration/intakeForms.routes.test.ts` (the one
  identical 404, the honeypot, the field caps, the reference-only answer with
  no model call, the ids-only audit rows, and the lanes answering before any
  lookup across two app instances),
  `backend/src/__tests__/integration/requestDeskForms.postgres.test.ts` (the
  SQL, opt-in like the request desk's), the `PublicRequestForm` and
  `RequestFormsManager` component tests, and `e2e/intake-form.spec.ts` (an
  anonymous submission reaches the board; the public page and the forms page
  pass the shared axe check).
