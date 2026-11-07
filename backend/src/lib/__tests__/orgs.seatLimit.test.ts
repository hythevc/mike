// SPDX-License-Identifier: AGPL-3.0-only
//
// The seat-limit wiring in createInvitation and acceptInvitation: with plans
// on and a finite limit they consult the seat functions and refuse when full;
// the atomic enforcement itself is tested against real PostgreSQL in
// seatLimit.postgres.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../supabase";
import { acceptInvitation, createInvitation } from "../orgs";

type Resp = { data: unknown; error: unknown };

/** A Db that returns a canned row per table for lookups (maybeSingle) and for
 *  insert().select().single(), and a canned value for each rpc. Bare inserts,
 *  updates and audit writes succeed. */
function fakeDb(config: {
    /** Response for `.maybeSingle()` (existence lookups). */
    maybeSingle?: Record<string, unknown>;
    /** Response for `.single()` (insert ... returning one row). */
    single?: Record<string, unknown>;
    rpc?: Record<string, unknown>;
    onRpc?: (fn: string) => void;
}): Db {
    const builder = (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
            chain[method] = () => chain;
        }
        chain.insert = () => chain;
        chain.update = () => chain;
        chain.delete = () => chain;
        chain.single = () =>
            Promise.resolve({
                data: config.single?.[table] ?? config.maybeSingle?.[table] ?? null,
                error: null,
            } as Resp);
        chain.maybeSingle = () =>
            Promise.resolve({
                data: config.maybeSingle?.[table] ?? null,
                error: null,
            } as Resp);
        // A bare await on the builder (insert/update) resolves to empty success.
        chain.then = (resolve: (v: Resp) => unknown) =>
            resolve({ data: [], error: null });
        return chain;
    };
    return {
        from: (table: string) => builder(table),
        rpc: (fn: string) => {
            config.onRpc?.(fn);
            return Promise.resolve({
                data: config.rpc?.[fn] ?? null,
                error: null,
            } as Resp);
        },
    } as unknown as Db;
}

const ORG = "00000000-0000-4000-8000-000000000010";
const ACTOR = "00000000-0000-4000-8000-000000000020";
const JOINER = "00000000-0000-4000-8000-000000000030";

beforeEach(() => {
    process.env.PLANS_ENABLED = "true";
    delete process.env.PLANS_CATALOG_JSON;
});
afterEach(() => {
    delete process.env.PLANS_ENABLED;
});

describe("createInvitation seat limit", () => {
    it("refuses a new invitation when members plus invitations fill the limit", async () => {
        const rpcCalls: string[] = [];
        const db = fakeDb({
            maybeSingle: {
                org_members: { role: "owner" },
                user_profiles: null,
                org_invitations: null,
                org_subscriptions: { org_id: ORG, seat_limit: 3, status: "active" },
            },
            rpc: { org_seat_state: [{ member_count: 2, pending_invite_count: 1 }] },
            onRpc: (fn) => rpcCalls.push(fn),
        });
        const result = await createInvitation(db, {
            actorId: ACTOR,
            actorEmail: "owner@firm.example",
            orgId: ORG,
            email: "new@client.example",
            role: "member",
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected refusal");
        expect(result.kind).toBe("seat_limit_reached");
        expect(rpcCalls).toContain("org_seat_state");
    });

    it("allows a new invitation when a seat is free", async () => {
        const db = fakeDb({
            maybeSingle: {
                org_members: { role: "owner" },
                user_profiles: null,
                org_invitations: null,
                org_subscriptions: { org_id: ORG, seat_limit: 3, status: "active" },
            },
            single: {
                org_invitations: {
                    id: "00000000-0000-4000-8000-0000000000b1",
                    org_id: ORG,
                    email: "new@client.example",
                    role: "member",
                    status: "pending",
                    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
                    invited_by: ACTOR,
                },
            },
            rpc: { org_seat_state: [{ member_count: 1, pending_invite_count: 1 }] },
        });
        const result = await createInvitation(db, {
            actorId: ACTOR,
            orgId: ORG,
            email: "new@client.example",
            role: "member",
        });
        expect(result.ok).toBe(true);
    });

    it("does not consult the seat functions when plans are off", async () => {
        process.env.PLANS_ENABLED = "false";
        const rpcCalls: string[] = [];
        const db = fakeDb({
            maybeSingle: {
                org_members: { role: "owner" },
                user_profiles: null,
                org_invitations: null,
            },
            single: {
                org_invitations: {
                    id: "00000000-0000-4000-8000-0000000000b2",
                    org_id: ORG,
                    email: "new@client.example",
                    role: "member",
                    status: "pending",
                    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
                    invited_by: ACTOR,
                },
            },
            onRpc: (fn) => rpcCalls.push(fn),
        });
        const result = await createInvitation(db, {
            actorId: ACTOR,
            orgId: ORG,
            email: "new@client.example",
            role: "member",
        });
        expect(result.ok).toBe(true);
        expect(rpcCalls).toEqual([]);
    });
});

describe("acceptInvitation seat limit", () => {
    const invite = {
        id: "00000000-0000-4000-8000-0000000000a1",
        org_id: ORG,
        email: "joiner@firm.example",
        role: "member",
        status: "pending",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it("claims a seat atomically and refuses when the claim is full", async () => {
        const rpcCalls: string[] = [];
        const db = fakeDb({
            maybeSingle: {
                org_invitations: invite,
                org_members: null, // not yet a member
                org_subscriptions: { org_id: ORG, seat_limit: 3, status: "active" },
            },
            rpc: { org_claim_seat: "seat_limit_reached" },
            onRpc: (fn) => rpcCalls.push(fn),
        });
        const result = await acceptInvitation(db, {
            userId: JOINER,
            userEmail: invite.email,
            invitationId: invite.id,
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected refusal");
        expect(result.kind).toBe("seat_limit_reached");
        expect(rpcCalls).toContain("org_claim_seat");
    });

    it("joins through the seat claim when a seat is free", async () => {
        const rpcCalls: string[] = [];
        const db = fakeDb({
            maybeSingle: {
                org_invitations: invite,
                org_members: null,
                org_subscriptions: { org_id: ORG, seat_limit: 3, status: "active" },
            },
            rpc: { org_claim_seat: "ok" },
            onRpc: (fn) => rpcCalls.push(fn),
        });
        const result = await acceptInvitation(db, {
            userId: JOINER,
            userEmail: invite.email,
            invitationId: invite.id,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected success");
        expect(result.org_id).toBe(ORG);
        expect(rpcCalls).toContain("org_claim_seat");
    });

    it("uses the direct insert, not the claim, when plans are off", async () => {
        process.env.PLANS_ENABLED = "false";
        const rpcCalls: string[] = [];
        const db = fakeDb({
            maybeSingle: {
                org_invitations: invite,
                org_members: null,
            },
            onRpc: (fn) => rpcCalls.push(fn),
        });
        const result = await acceptInvitation(db, {
            userId: JOINER,
            userEmail: invite.email,
            invitationId: invite.id,
        });
        expect(result.ok).toBe(true);
        expect(rpcCalls).toEqual([]);
    });
});

// Keep vi referenced for environments that tree-shake unused imports.
void vi;
