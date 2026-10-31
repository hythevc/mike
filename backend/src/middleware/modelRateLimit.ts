// SPDX-License-Identifier: AGPL-3.0-only
//
// Rate limits for requests that call a model for the signed-in user: chat,
// project chat and Word chat turns, tabular review chat and generation, and
// playbook reviews, plus starting a chat.
//
// Each router mounts these AFTER requireAuth, so a budget belongs to one user
// rather than to a network address: colleagues behind one office address no
// longer share it. The counts live in the shared store, so the budget is the
// same on every API replica and survives a deploy. If the store cannot answer
// these lanes let the request through: the caller is already authenticated,
// and a database hiccup should not stop work that is otherwise allowed. The
// address-keyed sign-in and public lanes in app.ts fail closed instead.

import type { Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { sharedRateLimit } from "../lib/rateLimitStore";
import { envInt } from "../lib/runtimeConfig";

function minutes(value: number): number {
  return value * 60 * 1000;
}

/**
 * The key for a model lane: the user requireAuth resolved. A request that
 * somehow arrives without one is keyed by address, never by a shared
 * constant, so it cannot drain other people's budget.
 */
export function modelLaneKey(req: Request, res: Response): string {
  const userId = res.locals.userId;
  if (typeof userId === "string" && userId) return `user:${userId}`;
  return `address:${ipKeyGenerator(
    req.ip ?? req.socket.remoteAddress ?? "unknown",
  )}`;
}

/**
 * One budget for every request that runs a model turn or review: POST /chat,
 * /projects/:projectId/chat, /word-chat, /tabular-review/:reviewId/chat and
 * /generate, and /playbooks/:playbookId/review.
 */
export const modelCallRateLimit = sharedRateLimit({
  lane: "model-calls",
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_MAX", 30),
  message: "Too many chat requests. Please try again later.",
  keyGenerator: modelLaneKey,
  onStoreFailure: "allow",
});

/** Starting a chat (POST /chat/create), which precedes its first turn. */
export const chatCreateRateLimit = sharedRateLimit({
  lane: "chat-create",
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_CREATE_MAX", 60),
  message: "Too many requests. Please try again later.",
  keyGenerator: modelLaneKey,
  onStoreFailure: "allow",
});
