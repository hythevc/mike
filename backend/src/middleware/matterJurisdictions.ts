// SPDX-License-Identifier: AGPL-3.0-only
//
// The routes of the matter jurisdiction profile exist only while a
// deployment has it switched on (MATTER_JURISDICTIONS_ENABLED; see
// lib/jurisdictionProfile.ts).

import type { NextFunction, Request, Response } from "express";
import { matterJurisdictionsEnabled } from "../lib/jurisdictionProfile";

/**
 * On every route the profile adds, before its handler. While the profile is
 * switched off the rest of the route is skipped (`next("route")`), so the
 * request is answered as it was before the route existed:
 * GET /projects/jurisdictions, where this comes first, goes on to the
 * project route behind it; the organization defaults path, where it follows
 * the guard every organization route starts with, ends in the ordinary
 * not-found answer.
 */
export function whileMatterJurisdictionsEnabled(
    _req: Request,
    _res: Response,
    next: NextFunction,
): void {
    if (matterJurisdictionsEnabled()) next();
    else next("route");
}
