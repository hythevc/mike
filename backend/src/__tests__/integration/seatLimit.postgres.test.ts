// SPDX-License-Identifier: AGPL-3.0-only
//
// Plans, seats and trials in real PostgreSQL: a trial row is created with
// every organization (team and personal), org_seat_state counts members and
// open invitations, and org_claim_seat holds the seat limit under a lock so
// two acceptances cannot both take the last seat. The TypeScript wiring that
// calls these is covered by lib/__tests__/orgs.seatLimit.test.ts.
//
// Opt in with one of (the first that is set wins):
//
//   MIKE_TEST_POSTGRES_CONTAINER=supabase_db_backend
//   MIKE_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres
//   SUPABASE_TEST_DB_URL   (set by `npm run test:stack`)
//
// It creates its own database, loads schema.sql, applies the migration twice
// (it must be safe to re-run), and drops it at the end.

import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const serverUrl =
    process.env.MIKE_TEST_POSTGRES_URL || process.env.SUPABASE_TEST_DB_URL;
const database = `mike_seat_limit_${process.pid}_${Date.now()}`;
const MIGRATION = "20261107_50_org_subscriptions.sql";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const FIRM = 10;
const OWNER = 1;
const MEMBER_A = 2;
const MEMBER_B = 3;
const JOINER_1 = 4;
const JOINER_2 = 5;

const PSQL_FLAGS = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];

function psql(target: "server" | "test"): { command: string; args: string[] } {
    if (container)
        return {
            command: "docker",
            args: [
                "exec", "-i", container, "psql", "-U", "postgres",
                "-d", target === "server" ? "postgres" : database,
                ...PSQL_FLAGS,
            ],
        };
    const url = new URL(serverUrl!);
    if (target === "test") url.pathname = `/${database}`;
    return { command: "psql", args: [...PSQL_FLAGS, "-d", url.toString()] };
}

function sql(text: string, target: "server" | "test" = "test"): string {
    const { command, args } = psql(target);
    try {
        return execFileSync(command, args, {
            input: text,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 16 * 1024 * 1024,
        }).trim();
    } catch (error) {
        const err = error as { stderr?: string; message?: string };
        throw new Error(err.stderr || err.message || "psql failed");
    }
}

async function sqlOnOwnConnection(...statements: string[]): Promise<string> {
    const { command, args } = psql("test");
    const { stdout } = await execFileAsync(
        command,
        [...args, ...statements.flatMap((statement) => ["-c", statement])],
        { encoding: "utf8" },
    );
    return stdout.trim();
}

const value = (text: string) => sql(text);
const count = (text: string) => Number(sql(text));

const claim = (org: number, user: number, limit: number | null) =>
    `select public.org_claim_seat(${q(org)}, ${q(user)}, 'member', ${limit ?? "null"})`;

describe.skipIf(!container && !serverUrl)("plans, seats and trials in PostgreSQL", () => {
    let created = false;

    beforeAll(() => {
        sql(
            `do $$ begin
                if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
                if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
                if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
            end $$;`,
            "server",
        );
        sql(`create database "${database}"`, "server");
        created = true;
        sql(`create schema auth;
            create table auth.users (id uuid primary key, email text,
                raw_user_meta_data jsonb default '{}', created_at timestamptz default now());`);
        sql(readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8"));
        const migration = readFileSync(
            resolve(__dirname, "../../../migrations", MIGRATION),
            "utf8",
        );
        sql(migration);
        sql(migration);
    }, 120_000);

    afterAll(() => {
        if (created) sql(`drop database if exists "${database}" with (force)`, "server");
    });

    beforeEach(() => {
        sql(`truncate auth.users, public.organizations, public.audit_events cascade;
            insert into auth.users (id, email) values
                (${q(OWNER)}, 'owner@firm.example'),
                (${q(MEMBER_A)}, 'a@firm.example'),
                (${q(MEMBER_B)}, 'b@firm.example'),
                (${q(JOINER_1)}, 'j1@firm.example'),
                (${q(JOINER_2)}, 'j2@firm.example');`);
    });

    it("creates a trialing subscription with a team organization", () => {
        sql(`insert into public.organizations (id, name, created_by)
            values (${q(FIRM)}, 'Firm', ${q(OWNER)})`);
        expect(
            value(`select status from public.org_subscriptions where org_id = ${q(FIRM)}`),
        ).toBe("trialing");
        // The trial has a future end from the default window.
        expect(
            value(`select trial_ends_at > now() from public.org_subscriptions where org_id = ${q(FIRM)}`),
        ).toBe("t");
        expect(
            value(`select plan_key is null and seat_limit is null
                from public.org_subscriptions where org_id = ${q(FIRM)}`),
        ).toBe("t");
    });

    it("creates a trialing subscription for a personal organization", () => {
        const personal = value(
            `select public.ensure_personal_organization(${q(OWNER)})`,
        );
        expect(personal).not.toBe("");
        expect(
            value(`select status from public.org_subscriptions where org_id = '${personal}'`),
        ).toBe("trialing");
        // The personal organization is a real organizations row with kind personal.
        expect(
            value(`select kind from public.organizations where id = '${personal}'`),
        ).toBe("personal");
    });

    it("counts members and open invitations in org_seat_state", () => {
        sql(`insert into public.organizations (id, name, created_by)
                values (${q(FIRM)}, 'Firm', ${q(OWNER)});
            insert into public.org_members (org_id, user_id, role) values
                (${q(FIRM)}, ${q(OWNER)}, 'owner'),
                (${q(FIRM)}, ${q(MEMBER_A)}, 'member'),
                (${q(FIRM)}, ${q(MEMBER_B)}, 'member');
            insert into public.org_invitations (org_id, email, role, status, expires_at) values
                (${q(FIRM)}, 'pending@x.example', 'member', 'pending', now() + interval '7 days'),
                (${q(FIRM)}, 'expired@x.example', 'member', 'pending', now() - interval '1 day'),
                (${q(FIRM)}, 'accepted@x.example', 'member', 'accepted', now() + interval '7 days');`);
        expect(
            value(`select member_count || '/' || pending_invite_count
                from public.org_seat_state(${q(FIRM)})`),
        ).toBe("3/1");
    });

    it("refuses a seat once the limit is full, and admits one while there is room", () => {
        sql(`insert into public.organizations (id, name, created_by)
                values (${q(FIRM)}, 'Firm', ${q(OWNER)});
            insert into public.org_members (org_id, user_id, role) values
                (${q(FIRM)}, ${q(OWNER)}, 'owner'),
                (${q(FIRM)}, ${q(MEMBER_A)}, 'member'),
                (${q(FIRM)}, ${q(MEMBER_B)}, 'member');`);
        // Three seats used, limit three: the fourth is refused.
        expect(value(claim(FIRM, JOINER_1, 3))).toBe("seat_limit_reached");
        expect(count(`select count(*) from public.org_members where org_id = ${q(FIRM)}`)).toBe(3);
        // A higher limit admits them.
        expect(value(claim(FIRM, JOINER_1, 4))).toBe("ok");
        expect(count(`select count(*) from public.org_members where org_id = ${q(FIRM)}`)).toBe(4);
        // A null limit (no plan limit) always admits.
        expect(value(claim(FIRM, JOINER_2, null))).toBe("ok");
        // Claiming for someone already a member takes no new seat.
        expect(value(claim(FIRM, OWNER, 1))).toBe("ok");
        expect(count(`select count(*) from public.org_members where org_id = ${q(FIRM)}`)).toBe(5);
    });

    it("lets only one of two simultaneous claims take the last seat", async () => {
        sql(`insert into public.organizations (id, name, created_by)
                values (${q(FIRM)}, 'Firm', ${q(OWNER)});
            insert into public.org_members (org_id, user_id, role) values
                (${q(FIRM)}, ${q(OWNER)}, 'owner'),
                (${q(FIRM)}, ${q(MEMBER_A)}, 'member');`);
        // Two seats used, limit three: exactly one more may join. Each claim
        // holds its transaction open briefly so they truly contend on the
        // organization-row lock org_claim_seat takes.
        const race = (user: number) =>
            sqlOnOwnConnection(
                "begin",
                claim(FIRM, user, 3),
                "select pg_sleep(0.05)",
                "commit",
            ).then((out) =>
                out
                    .split("\n")
                    .map((line) => line.trim())
                    .find((line) => line === "ok" || line === "seat_limit_reached"),
            );
        const outcomes = await Promise.all([race(JOINER_1), race(JOINER_2)]);
        expect([...outcomes].sort()).toEqual(["ok", "seat_limit_reached"]);
        expect(count(`select count(*) from public.org_members where org_id = ${q(FIRM)}`)).toBe(3);
    }, 30_000);

    it("keeps the seat functions and table off the browser roles", () => {
        for (const role of ["anon", "authenticated"]) {
            expect(
                value(`select has_function_privilege('${role}',
                    'public.org_claim_seat(uuid,uuid,text,integer)', 'execute')`),
            ).toBe("f");
            expect(
                value(`select has_function_privilege('${role}',
                    'public.org_seat_state(uuid)', 'execute')`),
            ).toBe("f");
            expect(
                value(`select has_table_privilege('${role}',
                    'public.org_subscriptions', 'select')`),
            ).toBe("f");
        }
        expect(
            value(`select has_function_privilege('service_role',
                'public.org_claim_seat(uuid,uuid,text,integer)', 'execute')`),
        ).toBe("t");
    });
});
