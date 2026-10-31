// SPDX-License-Identifier: AGPL-3.0-only
//
// Who a model call is made for, carried alongside the work instead of
// through every function signature between an entry point and the provider.
//
// Each entry point that starts AI work (a chat turn, a tabular row, a
// playbook run, a title, a subagent, a memory curation) runs it inside
// `runWithUsageContext`. The provider layer reads the context when it
// records the call in the usage ledger and when it checks the monthly cap on
// the deployment's own keys (lib/usage.ts). A call made outside any context
// is neither recorded nor capped, so every entry point must set one.

import { AsyncLocalStorage } from "node:async_hooks";

export const USAGE_SURFACES = [
    "chat",
    "project_chat",
    "word",
    "tabular",
    "playbook",
    "title",
    "subagent",
    "memory",
] as const;

export type UsageSurface = (typeof USAGE_SURFACES)[number];

export type UsageContext = {
    /** The person the work is done for. */
    userId: string;
    /**
     * The organization the work belongs to, or null for the person's own
     * (Personal) workspace. Usage and the monthly cap are counted per
     * workspace.
     */
    orgId: string | null;
    /** The matter (project) the work is part of, if any. */
    projectId: string | null;
    surface: UsageSurface;
    /** The chat, review or run the call belongs to, as far as it is known. */
    chatId?: string | null;
    reviewId?: string | null;
    runId?: string | null;
    /** The one document the call reads, when there is exactly one. */
    documentId?: string | null;
    /** Pages of the documents the call reads, when known. */
    documentPages?: number | null;
};

/**
 * Who and where, without the surface: what an entry point hands a service
 * that adds the surface and ids of the work it does.
 */
export type UsageScope = Pick<UsageContext, "userId" | "orgId" | "projectId">;

/** The parts of a context a nested piece of work may add or replace. */
export type UsageDetails = Partial<
    Pick<
        UsageContext,
        "chatId" | "reviewId" | "runId" | "documentId" | "documentPages"
    >
>;

const storage = new AsyncLocalStorage<UsageContext>();

/** Run `work` (and everything it starts) on behalf of `context`. */
export function runWithUsageContext<T>(
    context: UsageContext,
    work: () => T,
): T {
    return storage.run(Object.freeze({ ...context }), work);
}

/**
 * Run `work` inside the current context under another surface, for work that
 * one entry point starts on behalf of another (a title for a chat, a
 * subagent for an answer). Without an enclosing context there is nobody to
 * attribute it to, and `work` runs as it is.
 */
export function withUsageSurface<T>(
    surface: UsageSurface,
    details: UsageDetails,
    work: () => T,
): T {
    const parent = storage.getStore();
    return parent
        ? runWithUsageContext({ ...parent, ...details, surface }, work)
        : work();
}

/** The context the current work runs in, if any. */
export function currentUsageContext(): UsageContext | undefined {
    return storage.getStore();
}
