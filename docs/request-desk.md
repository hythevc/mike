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

Deleting an account keeps the organization's requests and trail and clears
the links to that person. Deleting a project clears the link to it. Purging
an organization deletes its requests, trail and counter.

## Audit and export

Each action records one audit row with surface `intake` and ids only:
`request.created`, `request.updated`, `request.status_changed`,
`request.assigned`, `request.unassigned`, `request.commented` and
`request.matter_created`. Titles, details, requester data, notes and
comments never reach the audit log.

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
