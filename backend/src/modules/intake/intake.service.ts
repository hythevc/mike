// SPDX-License-Identifier: AGPL-3.0-only
//
// Facade of the intake module: an organization's request desk. Requests from
// clients or colleagues get a per-organization reference, a status, a
// priority, a due date and an assignee, and can become a matter.
//
// The implementation is split by topic behind this file:
//
//   intake.shared.ts       vocabulary, access rule, serialization, audit
//   intake.requests.ts     list, read, log and edit requests
//   intake.transitions.ts  status changes and assignment
//   intake.matter.ts       create a matter from a request
//   intake.comments.ts     the activity trail
//   intake.board.ts        the triage board's counts
//
// Database objects: request_desk_* (backend/migrations/20261031_53_request_desk.sql).

export {
    createRequest,
    getRequest,
    listRequests,
    updateRequest,
} from "./intake.requests";

export { assignRequest, changeRequestStatus } from "./intake.transitions";

export { createMatterFromRequest } from "./intake.matter";

export { addRequestComment, listRequestComments } from "./intake.comments";

export { getRequestDeskBoard } from "./intake.board";
