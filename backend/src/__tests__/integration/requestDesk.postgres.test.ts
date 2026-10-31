// SPDX-License-Identifier: AGPL-3.0-only
//
// The request desk's tables and functions in real PostgreSQL: concurrent
// reference allocation, what deleting an account or purging an organization
// leaves behind, status changes, the integrity guard and the grants.
//
// Opt in with one of (the first that is set wins):
//
//   MIKE_TEST_POSTGRES_CONTAINER=supabase_db_backend
//       a local Supabase database container, reached with docker exec
//   MIKE_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres
//       any disposable PostgreSQL server you can create databases on
//   SUPABASE_TEST_DB_URL
//       set by `npm run test:stack` from `supabase status`
//
// Every mode creates its own database, loads schema.sql into it, applies the
// migration twice on top (it must be safe to re-run), and drops it at the
// end. The server's other databases are never touched; on a server without
// Supabase's anon, authenticated and service_role roles they are created.

import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const serverUrl =
    process.env.MIKE_TEST_POSTGRES_URL || process.env.SUPABASE_TEST_DB_URL;
const database = `mike_request_desk_${process.pid}_${Date.now()}`;
const MIGRATION = "20261031_53_request_desk.sql";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const FIRM = 10;
const OTHER = 11;
const FIRM_MATTER = 20;
const OTHER_MATTER = 21;

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

/**
 * Run SQL in the test database (or the server's own, for setup). A failure
 * throws with PostgreSQL's message, so tests can match on it.
 */
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
        const stderr = (error as { stderr?: unknown }).stderr;
        throw new Error(typeof stderr === "string" && stderr ? stderr : String(error));
    }
}

/** Run statements on a connection of their own, so that many run at once. */
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

function createRequest(
    org: number,
    options: { by?: number | null; assignee?: number | null; title?: string } = {},
): string {
    const by = options.by === null ? "null" : q(options.by ?? 2);
    const assignee = options.assignee ? q(options.assignee) : "null";
    return `select id from public.request_desk_create_request(${q(org)}, ${by}, 'internal', '${options.title ?? "Engagement letter"}', '', null, 'normal', 'Dana Client', 'dana@client.example', ${assignee}, null)`;
}

describe.skipIf(!container && !serverUrl)("request desk in PostgreSQL", () => {
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
                (${q(1)}, 'owner@firm.example'), (${q(2)}, 'member@firm.example'),
                (${q(3)}, 'colleague@firm.example'), (${q(4)}, 'owner@other.example');
            insert into public.organizations (id, name, created_by) values
                (${q(FIRM)}, 'Firm', ${q(1)}), (${q(OTHER)}, 'Other firm', ${q(4)});
            insert into public.org_members (org_id, user_id, role) values
                (${q(FIRM)}, ${q(1)}, 'owner'), (${q(FIRM)}, ${q(2)}, 'member'),
                (${q(FIRM)}, ${q(3)}, 'member'), (${q(OTHER)}, ${q(4)}, 'owner');
            insert into public.projects (id, org_id, user_id, name) values
                (${q(FIRM_MATTER)}, ${q(FIRM)}, ${q(2)}, 'Firm matter'),
                (${q(OTHER_MATTER)}, ${q(OTHER)}, ${q(4)}, 'Other matter');`);
    });

    it("gives 50 concurrent creates in one organization 50 distinct, consecutive references, numbered per organization", async () => {
        // Each create holds its transaction open a little after allocating,
        // so the creates really do queue on the organization's counter.
        const allocate = (org: number, by: number, n: number) =>
            sqlOnOwnConnection(
                "begin",
                `select reference from public.request_desk_create_request(${q(org)}, ${q(by)}, 'internal', 'Request ${n}', '', null, 'normal', null, null, null, null)`,
                "select pg_sleep(0.02)",
                "commit",
            ).then((out) => out.split("\n")[0]);
        const results = await Promise.all([
            ...Array.from({ length: 50 }, (_, n) => allocate(FIRM, 1 + (n % 3), n)),
            ...Array.from({ length: 5 }, (_, n) => allocate(OTHER, 4, n)),
        ]);
        const firm = results.slice(0, 50);
        const other = results.slice(50);

        expect(new Set(firm).size).toBe(50);
        expect([...firm].sort()).toEqual(
            Array.from({ length: 50 }, (_, n) => `REQ-${n + 1}`).sort(),
        );
        expect([...other].sort()).toEqual(["REQ-1", "REQ-2", "REQ-3", "REQ-4", "REQ-5"]);
        expect(
            value(`select string_agg(reference_number::text, ',' order by reference_number)
                from public.request_desk_requests where org_id = ${q(FIRM)}`),
        ).toBe(Array.from({ length: 50 }, (_, n) => n + 1).join(","));
        expect(
            value(`select string_agg(org_id::text || '=' || last_number, ',' order by org_id)
                from public.request_desk_counters`),
        ).toBe(`${uid(FIRM)}=50,${uid(OTHER)}=5`);
    }, 60_000);

    it("leaves the rows with nulls when a user who is requester (created_by), assignee and comment author is deleted", () => {
        const id = sql(createRequest(FIRM, { by: 2, assignee: 2 }));
        sql(`select public.request_desk_change_status('${id}', ${q(FIRM)}, ${q(2)}, 'in_progress', 'Started', null)`);
        sql(`insert into public.request_desk_comments (request_id, org_id, author_user_id, body)
            values ('${id}', ${q(FIRM)}, ${q(2)}, 'Called the client')`);
        expect(count(`select count(*) from public.request_desk_comments where request_id = '${id}'`)).toBe(3);

        sql(`delete from auth.users where id = ${q(2)}`);

        expect(
            value(`select concat_ws('|', coalesce(created_by::text, 'null'), coalesce(assignee_user_id::text, 'null'),
                requester_name, requester_email, status)
                from public.request_desk_requests where id = '${id}'`),
        ).toBe("null|null|Dana Client|dana@client.example|in_progress");
        expect(
            value(`select string_agg(kind || ':' || coalesce(author_user_id::text, 'null') || ':' ||
                coalesce(subject_user_id::text, 'null'), ',' order by created_at, kind)
                from public.request_desk_comments where request_id = '${id}'`),
        ).toBe("system:null:null,status_change:null:null,comment:null:null");
    });

    it("purges an organization whose requests link to its projects", () => {
        const linked = sql(createRequest(FIRM));
        expect(
            value(`select public.request_desk_link_matter('${linked}', ${q(FIRM)}, ${q(2)}, ${q(FIRM_MATTER)})->>'outcome'`),
        ).toBe("changed");
        sql(`insert into public.request_desk_comments (request_id, org_id, author_user_id, body)
            values ('${linked}', ${q(FIRM)}, ${q(1)}, 'Matter opened')`);
        const kept = sql(createRequest(OTHER, { by: 4 }));

        expect(
            value(`update public.organizations set deleted_at = now() - interval '31 days', purge_after = now()
                where id = ${q(FIRM)};
                select public.purge_expired_organizations(10);`),
        ).toBe("1");

        for (const tableName of ["request_desk_requests", "request_desk_comments", "request_desk_counters", "projects"])
            expect(count(`select count(*) from public.${tableName} where org_id = ${q(FIRM)}`)).toBe(0);
        expect(value(`select reference from public.request_desk_requests where id = '${kept}'`)).toBe("REQ-1");
        expect(count(`select count(*) from public.request_desk_counters where org_id = ${q(OTHER)}`)).toBe(1);
    });

    it("unlinks a request, keeping it, when its matter is deleted", () => {
        const id = sql(createRequest(FIRM));
        sql(`select public.request_desk_link_matter('${id}', ${q(FIRM)}, ${q(2)}, ${q(FIRM_MATTER)})`);
        sql(`delete from public.projects where id = ${q(FIRM_MATTER)}`);
        expect(value(`select coalesce(project_id::text, 'null') from public.request_desk_requests where id = '${id}'`)).toBe("null");
    });

    it("writes one status_change entry per change and sets, keeps and clears closed_at", () => {
        const id = sql(createRequest(FIRM));
        const change = (status: string, expected = "null") =>
            value(`select public.request_desk_change_status('${id}', ${q(FIRM)}, ${q(2)}, '${status}', null, ${expected})->>'outcome'`);
        const closedAt = () => value(`select coalesce(closed_at::text, 'null') from public.request_desk_requests where id = '${id}'`);
        const entries = () => count(`select count(*) from public.request_desk_comments where request_id = '${id}' and kind = 'status_change'`);

        expect(change("closed")).toBe("changed");
        const firstClosed = closedAt();
        expect(firstClosed).not.toBe("null");
        expect(entries()).toBe(1);

        expect(change("closed")).toBe("unchanged");
        expect(entries()).toBe(1);

        expect(change("declined")).toBe("changed");
        expect(closedAt()).toBe(firstClosed);

        expect(change("in_progress", "'new'")).toBe("conflict");
        expect(entries()).toBe(2);

        expect(change("in_progress", "'declined'")).toBe("changed");
        expect(closedAt()).toBe("null");
        expect(
            value(`select string_agg(from_status || '>' || to_status, ',' order by created_at)
                from public.request_desk_comments where request_id = '${id}'`),
        ).toBe("new>closed,closed>declined,declined>in_progress");

        expect(() => change("archived")).toThrow(/unknown status/);
        expect(() =>
            sql(`update public.request_desk_requests set status = 'closed' where id = '${id}'`),
        ).toThrow(/request_desk_requests_closed_check/);
    });

    it("lets only one of two members take an unassigned request", () => {
        const id = sql(createRequest(FIRM, { by: 1 }));
        const take = (member: number) =>
            value(`select public.request_desk_assign('${id}', ${q(FIRM)}, ${q(member)}, ${q(member)}, true)->>'outcome'`);
        expect(take(2)).toBe("changed");
        expect(take(3)).toBe("conflict");
        expect(value(`select assignee_user_id from public.request_desk_requests where id = '${id}'`)).toBe(uid(2));
        expect(
            value(`select public.request_desk_assign('${id}', ${q(FIRM)}, ${q(1)}, null, false)->>'outcome'`),
        ).toBe("changed");
        expect(
            value(`select string_agg(event || ':' || subject_user_id, ',' order by created_at)
                from public.request_desk_comments where request_id = '${id}'`),
        ).toBe(`assigned:${uid(2)},unassigned:${uid(2)}`);
    });

    it("refuses Personal, non-member assignees, another workspace's matter and moving a request, rolling the number back", () => {
        const personal = value(`select id from public.organizations where personal_user_id = ${q(2)}`);
        expect(personal).toMatch(/^[0-9a-f-]{36}$/);
        expect(() =>
            sql(`select public.request_desk_create_request('${personal}', ${q(2)}, 'internal', 'Mine', '', null, null, null, null, null, null)`),
        ).toThrow(/active team organization/);
        expect(() => sql(createRequest(FIRM, { assignee: 4 }))).toThrow(/not a member/);

        const id = sql(createRequest(FIRM));
        expect(value(`select reference from public.request_desk_requests where id = '${id}'`)).toBe("REQ-1");
        expect(() =>
            sql(`select public.request_desk_link_matter('${id}', ${q(FIRM)}, ${q(2)}, ${q(OTHER_MATTER)})`),
        ).toThrow(/another workspace/);
        expect(() =>
            sql(`update public.request_desk_requests set org_id = ${q(OTHER)} where id = '${id}'`),
        ).toThrow(/cannot move/);
        expect(() =>
            sql(`select public.request_desk_assign('${id}', ${q(FIRM)}, ${q(1)}, ${q(4)}, false)`),
        ).toThrow(/not a member/);
        expect(count(`select count(*) from public.request_desk_comments where request_id = '${id}'`)).toBe(0);
        expect(count(`select last_number from public.request_desk_counters where org_id = ${q(FIRM)}`)).toBe(1);

        // A soft-deleted organization takes no new requests.
        sql(`update public.organizations set deleted_at = now(), purge_after = now() + interval '30 days' where id = ${q(FIRM)}`);
        expect(() => sql(createRequest(FIRM))).toThrow(/active team organization/);
    });

    it("counts the board: open, overdue, unassigned and the caller's", () => {
        const make = (assignee: number | null) => sql(createRequest(FIRM, { by: 1, assignee }));
        const overdue = make(2);
        const mine = make(2);
        make(null);
        const closed = make(3);
        sql(`update public.request_desk_requests set sla_due_at = now() - interval '1 day', priority = 'urgent' where id = '${overdue}';
            update public.request_desk_requests set sla_due_at = now() + interval '1 day' where id = '${mine}';
            update public.request_desk_requests set sla_due_at = now() - interval '1 day' where id = '${closed}';
            select public.request_desk_change_status('${closed}', ${q(FIRM)}, ${q(3)}, 'closed', null, null);`);

        expect(JSON.parse(value(`select public.request_desk_board_summary(${q(FIRM)}, ${q(2)})`))).toEqual({
            total: 4,
            open: 3,
            overdue: 1,
            unassigned: 1,
            assigned_to_me: 2,
            by_status: { new: 3, in_progress: 0, waiting: 0, closed: 1, declined: 0 },
            open_by_priority: { low: 0, normal: 2, high: 0, urgent: 1 },
        });
        expect(JSON.parse(value(`select public.request_desk_board_summary(${q(OTHER)}, ${q(4)})`))).toMatchObject({
            total: 0,
        });
    });

    it("enables RLS, gives the browser roles nothing and service_role only what the backend uses", () => {
        const tables = ["request_desk_requests", "request_desk_comments", "request_desk_counters"];
        for (const tableName of tables) {
            expect(value(`select relrowsecurity from pg_class where oid = 'public.${tableName}'::regclass`)).toBe("t");
            for (const role of ["anon", "authenticated"])
                for (const privilege of ["select", "insert", "update", "delete", "truncate", "references", "trigger"])
                    expect(
                        value(`select has_table_privilege('${role}', 'public.${tableName}', '${privilege}')`),
                        `${role} ${privilege} on ${tableName}`,
                    ).toBe("f");
        }
        const servicePrivileges = (tableName: string) =>
            ["select", "insert", "update", "delete"].filter(
                (privilege) => value(`select has_table_privilege('service_role', 'public.${tableName}', '${privilege}')`) === "t",
            );
        expect(servicePrivileges("request_desk_requests")).toEqual(["select", "update"]);
        expect(servicePrivileges("request_desk_comments")).toEqual(["select", "insert"]);
        expect(servicePrivileges("request_desk_counters")).toEqual([]);

        const functions = [
            "request_desk_create_request(uuid, uuid, text, text, text, text, text, text, text, uuid, timestamptz)",
            "request_desk_change_status(uuid, uuid, uuid, text, text, text)",
            "request_desk_assign(uuid, uuid, uuid, uuid, boolean)",
            "request_desk_link_matter(uuid, uuid, uuid, uuid)",
            "request_desk_board_summary(uuid, uuid)",
        ];
        for (const fn of functions) {
            for (const role of ["anon", "authenticated"])
                expect(value(`select has_function_privilege('${role}', 'public.${fn}', 'execute')`), `${role} ${fn}`).toBe("f");
            expect(value(`select has_function_privilege('service_role', 'public.${fn}', 'execute')`), fn).toBe("t");
        }
        for (const role of ["anon", "authenticated"])
            expect(value(`select has_function_privilege('${role}', 'public.request_desk_requests_guard()', 'execute')`)).toBe("f");
        // The security-definer functions pin their search_path.
        expect(
            value(`select count(*) from pg_proc where proname like 'request_desk_%' and prosecdef
                and not (proconfig @> array['search_path=""'])`),
        ).toBe("0");
    });
});
