// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP layer for the request desk, mounted at /intake. Handlers read the
// caller off res.locals, hand params, query and body to the intake service,
// and map its ServiceResults onto status codes and JSON. Nothing here touches
// the database.
//
//   GET    /intake/requests?workspace=<org id>   one page of requests
//   POST   /intake/requests                      log a request (org_id in body)
//   GET    /intake/board?workspace=<org id>      the triage board's counts
//   GET    /intake/requests/:requestId           one request
//   PATCH  /intake/requests/:requestId           edit its details
//   POST   /intake/requests/:requestId/status    change its status
//   PUT    /intake/requests/:requestId/assignee  assign, take or unassign it
//   GET    /intake/requests/:requestId/comments  its activity trail
//   POST   /intake/requests/:requestId/comments  comment on it
//   POST   /intake/requests/:requestId/matter    create a matter from it
//
// Request forms, for the organization's owners and admins:
//
//   GET    /intake/forms?workspace=<org id>      the organization's forms
//   POST   /intake/forms                         create one (org_id in body);
//                                                the link token is in the
//                                                answer, this once
//   PATCH  /intake/forms/:formId                 edit its notices and
//                                                settings, or enable/disable
//   POST   /intake/forms/:formId/rotate          replace its link
//
// Organization workspaces only: a Personal workspace is answered with 400
// request_desk_org_only.
//
// The public side is requestFormsRouter, mounted at /request-forms with no
// requireAuth, behind the dedicated rate-limit lanes app.ts registers ahead
// of it:
//
//   GET    /request-forms/:token                 what the form shows
//   POST   /request-forms/:token/submit          a submission; answers with
//                                                the reference only

import { Router, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import {
    addRequestComment,
    assignRequest,
    changeRequestStatus,
    createMatterFromRequest,
    createRequest,
    createRequestForm,
    getPublicRequestForm,
    getRequest,
    getRequestDeskBoard,
    listRequestComments,
    listRequestForms,
    listRequests,
    rotateRequestFormLink,
    submitPublicRequestForm,
    updateRequest,
    updateRequestForm,
} from "./intake.service";

export const intakeRouter = Router();

function caller(res: Response) {
    return {
        userId: res.locals.userId as string,
        userEmail: res.locals.userEmail as string | undefined,
    };
}

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(status).json(result.data);
}

intakeRouter.get(
    "/requests",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await listRequests(createServerSupabase(), {
                ...caller(res),
                workspace: req.query.workspace,
                query: req.query as Record<string, unknown>,
            }),
        );
    }),
);

intakeRouter.post(
    "/requests",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await createRequest(createServerSupabase(), {
                ...caller(res),
                body: req.body,
            }),
            201,
        );
    }),
);

intakeRouter.get(
    "/board",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await getRequestDeskBoard(createServerSupabase(), {
                ...caller(res),
                workspace: req.query.workspace,
            }),
        );
    }),
);

intakeRouter.get(
    "/requests/:requestId",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await getRequest(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
            }),
        );
    }),
);

intakeRouter.patch(
    "/requests/:requestId",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await updateRequest(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
                body: req.body,
            }),
        );
    }),
);

intakeRouter.post(
    "/requests/:requestId/status",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await changeRequestStatus(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
                body: req.body,
            }),
        );
    }),
);

intakeRouter.put(
    "/requests/:requestId/assignee",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await assignRequest(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
                body: req.body,
            }),
        );
    }),
);

intakeRouter.get(
    "/requests/:requestId/comments",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await listRequestComments(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
            }),
        );
    }),
);

intakeRouter.post(
    "/requests/:requestId/comments",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await addRequestComment(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
                body: req.body,
            }),
            201,
        );
    }),
);

intakeRouter.post(
    "/requests/:requestId/matter",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await createMatterFromRequest(createServerSupabase(), {
                ...caller(res),
                requestId: req.params.requestId,
                body: req.body,
            }),
            201,
        );
    }),
);

intakeRouter.get(
    "/forms",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await listRequestForms(createServerSupabase(), {
                ...caller(res),
                workspace: req.query.workspace,
            }),
        );
    }),
);

intakeRouter.post(
    "/forms",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await createRequestForm(createServerSupabase(), {
                ...caller(res),
                body: req.body,
            }),
            201,
        );
    }),
);

intakeRouter.patch(
    "/forms/:formId",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await updateRequestForm(createServerSupabase(), {
                ...caller(res),
                formId: req.params.formId,
                body: req.body,
            }),
        );
    }),
);

intakeRouter.post(
    "/forms/:formId/rotate",
    requireAuth,
    asyncRoute(async (req, res) => {
        send(
            res,
            await rotateRequestFormLink(createServerSupabase(), {
                ...caller(res),
                formId: req.params.formId,
            }),
        );
    }),
);

intakeRouter.use(routerErrorHandler("[intake]"));

// ---------------------------------------------------------------------------
// The public form. No session: whoever holds the link may read the form and
// submit through it. The answers carry nothing a visitor should not have (the
// organization's name and logo, the notices, and on submission the reference
// alone), and never a cached copy of a form that was since rotated or
// disabled.
// ---------------------------------------------------------------------------

export const requestFormsRouter = Router();

requestFormsRouter.get(
    "/:token",
    asyncRoute(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        send(
            res,
            await getPublicRequestForm(createServerSupabase(), {
                token: req.params.token,
            }),
        );
    }),
);

requestFormsRouter.post(
    "/:token/submit",
    asyncRoute(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        send(
            res,
            await submitPublicRequestForm(createServerSupabase(), {
                token: req.params.token,
                body: req.body,
            }),
            201,
        );
    }),
);

requestFormsRouter.use(routerErrorHandler("[request-forms]"));
