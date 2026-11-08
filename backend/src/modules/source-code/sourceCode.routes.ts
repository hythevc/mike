// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP layer for the source-code module — GET /source (JSON).
//
// Deliberately unauthenticated: AGPL-3.0 section 13 requires the corresponding
// source to be offered to every network user, signed in or not. The handler
// reads nothing from the request; it calls the service and returns its result.

import { Router } from "express";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import { getSourceOffer } from "./sourceCode.service";

export const sourceCodeRouter = Router();

sourceCodeRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const result = await getSourceOffer(createServerSupabase());
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
  }),
);

sourceCodeRouter.use(routerErrorHandler("[source]"));
