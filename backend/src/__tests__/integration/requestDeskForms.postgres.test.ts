// SPDX-License-Identifier: AGPL-3.0-only
//
// The request forms' tables and functions in real PostgreSQL: a submission
// through an enabled form, the refusal of a disabled one, retention of
// expired unconverted submissions, what deleting a form or purging an
// organization leaves behind, the token digest constraints and the grants.
//
// Opt in the same way as requestDesk.postgres.test.ts (the first that is set
// wins): MIKE_TEST_POSTGRES_CONTAINER, MIKE_TEST_POSTGRES_URL or
// SUPABASE_TEST_DB_URL. Every mode creates its own database, loads
// schema.sql, applies the migration twice on top (it must be safe to re-run)
// and drops the database at the end.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const serverUrl =
    process.env.MIKE_TEST_POSTGRES_URL || process.env.SUPABASE_TEST_DB_URL;
const database = `mike_request_forms_${process.pid}_${Date.now()}`;
const MIGRATION = "20261108_50_request_desk_forms.sql";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const FIRM = 10;
const OTHER = 11;
const FIRM_MATTER = 20;
const SHORT_FORM = 30;
const LONG_FORM = 31;
const OFF_FORM = 32;
/** sha256 digests standing in for real tokens; the shape is all the schema checks. */
const digest = (n: number) => `'${n.toString(16).padStart(64, "0")}'`;

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

/** Run SQL in the test database (or the server's own, for setup); a failure throws PostgreSQL's message. */
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

const value = (text: string) => sql(text);
const count = (text: string) => Number(sql(text));

function createForm(id: number, org: number, retentionDays: number, enabled = true): void {
    sql(`insert into public.request_desk_forms
        (id, org_id, created_by, token_hash, enabled, title, disclaimer, privacy_notice, retention_days)
        values (${q(id)}, ${q(org)}, ${q(1)}, ${digest(id)}, ${enabled}, 'Legal request',
            'Not legal advice.', 'The firm controls your data.', ${retentionDays})`);
}

function submit(form: number, title: string): string {
    return sql(`select id from public.request_desk_submit_form_request(${q(form)}, '${title}', 'Details.', 'Dana Client', 'dana@acme.example')`);
}

function age(requestId: string, days: number): void {
    sql(`update public.request_desk_requests set created_at = now() - interval '${days} days' where id = '${requestId}'`);
}

describe.skipIf(!container && !serverUrl)("request forms in PostgreSQL", () => {
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
                (${q(1)}, 'owner@firm.example'), (${q(2)}, 'member@firm.example'), (${q(4)}, 'owner@other.example');
            insert into public.organizations (id, name, created_by) values
                (${q(FIRM)}, 'Firm', ${q(1)}), (${q(OTHER)}, 'Other firm', ${q(4)});
            insert into public.org_members (org_id, user_id, role) values
                (${q(FIRM)}, ${q(1)}, 'owner'), (${q(FIRM)}, ${q(2)}, 'member'), (${q(OTHER)}, ${q(4)}, 'owner');
            insert into public.projects (id, org_id, user_id, name) values
                (${q(FIRM_MATTER)}, ${q(FIRM)}, ${q(2)}, 'Firm matter');`);
        createForm(SHORT_FORM, FIRM, 30);
        createForm(LONG_FORM, FIRM, 365);
        createForm(OFF_FORM, FIRM, 365, false);
    });

    it("files a submission as a 'form' request with no creator, the next reference and its form", () => {
        sql(`select public.request_desk_create_request(${q(FIRM)}, ${q(2)}, 'internal', 'Internal first', '', null, 'normal', null, null, null, null)`);
        const id = submit(SHORT_FORM, "NDA review");
        expect(
            value(`select concat_ws('|', reference, source, coalesce(created_by::text, 'null'), form_id::text, status, priority, requester_name, requester_email, title)
                from public.request_desk_requests where id = '${id}'`),
        ).toBe(`REQ-2|form|null|${uid(SHORT_FORM)}|new|normal|Dana Client|dana@acme.example|NDA review`);
        expect(count(`select count(*) from public.request_desk_comments where request_id = '${id}'`)).toBe(0);
    });

    it("refuses a submission through a disabled or unknown form as a check_violation", () => {
        expect(() => submit(OFF_FORM, "Blocked")).toThrow(/the form is not available/);
        expect(() => submit(99, "Blocked")).toThrow(/the form is not available/);
        expect(count(`select count(*) from public.request_desk_requests`)).toBe(0);
    });

    it("deletes expired unconverted submissions with their trail and keeps converted, recent and internal ones", () => {
        const expired = submit(SHORT_FORM, "Expired");
        const converted = submit(SHORT_FORM, "Converted");
        const recent = submit(SHORT_FORM, "Recent");
        const longer = submit(LONG_FORM, "Longer period");
        const internal = sql(`select id from public.request_desk_create_request(${q(FIRM)}, ${q(2)}, 'internal', 'Internal', '', null, 'normal', null, null, null, null)`);
        age(expired, 31);
        age(converted, 31);
        age(recent, 29);
        age(longer, 31);
        age(internal, 400);
        sql(`select public.request_desk_link_matter('${converted}', ${q(FIRM)}, ${q(2)}, ${q(FIRM_MATTER)})`);
        sql(`insert into public.request_desk_comments (request_id, org_id, author_user_id, body)
            values ('${expired}', ${q(FIRM)}, ${q(2)}, 'Following up')`);

        expect(value(`select public.request_desk_delete_expired_form_submissions(500)`)).toBe("1");
        expect(
            value(`select string_agg(title, ',' order by title) from public.request_desk_requests`),
        ).toBe("Converted,Internal,Longer period,Recent");
        expect(count(`select count(*) from public.request_desk_comments where request_id = '${expired}'`)).toBe(0);
        // Nothing left to delete: the next sweep finds none.
        expect(value(`select public.request_desk_delete_expired_form_submissions(500)`)).toBe("0");
    });

    it("deletes oldest first, at most p_limit per call, and falls back to 365 days for a submission whose form is gone", () => {
        const first = submit(SHORT_FORM, "First");
        const second = submit(SHORT_FORM, "Second");
        const orphan = submit(LONG_FORM, "Orphan");
        age(first, 40);
        age(second, 35);
        age(orphan, 366);
        sql(`delete from public.request_desk_forms where id = ${q(LONG_FORM)}`);
        expect(value(`select coalesce(form_id::text, 'null') from public.request_desk_requests where id = '${orphan}'`)).toBe("null");

        expect(value(`select public.request_desk_delete_expired_form_submissions(1)`)).toBe("1");
        expect(count(`select count(*) from public.request_desk_requests where id = '${orphan}'`)).toBe(0);
        expect(value(`select public.request_desk_delete_expired_form_submissions(1)`)).toBe("1");
        expect(count(`select count(*) from public.request_desk_requests where id = '${first}'`)).toBe(0);
        expect(count(`select count(*) from public.request_desk_requests where id = '${second}'`)).toBe(1);
    });

    it("keeps only a well-formed, unique digest and purges forms with their organization", () => {
        expect(() =>
            sql(`insert into public.request_desk_forms (org_id, token_hash, title, disclaimer, privacy_notice)
                values (${q(FIRM)}, 'not-a-digest', 'Legal request', 'Not legal advice.', 'Notice.')`),
        ).toThrow(/request_desk_forms_token_hash_check/);
        expect(() =>
            sql(`insert into public.request_desk_forms (org_id, token_hash, title, disclaimer, privacy_notice)
                values (${q(FIRM)}, ${digest(SHORT_FORM)}, 'Legal request', 'Not legal advice.', 'Notice.')`),
        ).toThrow(/request_desk_forms_token_hash_key/);
        expect(() =>
            sql(`update public.request_desk_forms set retention_days = 0 where id = ${q(SHORT_FORM)}`),
        ).toThrow(/request_desk_forms_retention_days_check/);

        submit(SHORT_FORM, "Kept until purge");
        sql(`update public.organizations set deleted_at = now() - interval '31 days', purge_after = now()
            where id = ${q(FIRM)};
            select public.purge_expired_organizations(10);`);
        expect(count(`select count(*) from public.request_desk_forms where org_id = ${q(FIRM)}`)).toBe(0);
        expect(count(`select count(*) from public.request_desk_requests where org_id = ${q(FIRM)}`)).toBe(0);
    });

    it("gives the browser roles nothing and service_role no delete on forms or requests", () => {
        for (const role of ["anon", "authenticated"]) {
            for (const privilege of ["select", "insert", "update", "delete"])
                expect(
                    value(`select has_table_privilege('${role}', 'public.request_desk_forms', '${privilege}')`),
                    `${role} ${privilege}`,
                ).toBe("f");
            expect(value(`select has_function_privilege('${role}', 'public.request_desk_submit_form_request(uuid, text, text, text, text)', 'execute')`)).toBe("f");
            expect(value(`select has_function_privilege('${role}', 'public.request_desk_delete_expired_form_submissions(integer)', 'execute')`)).toBe("f");
        }
        expect(value(`select has_table_privilege('service_role', 'public.request_desk_forms', 'select')`)).toBe("t");
        expect(value(`select has_table_privilege('service_role', 'public.request_desk_forms', 'insert')`)).toBe("t");
        expect(value(`select has_table_privilege('service_role', 'public.request_desk_forms', 'update')`)).toBe("t");
        expect(value(`select has_table_privilege('service_role', 'public.request_desk_forms', 'delete')`)).toBe("f");
        expect(value(`select has_table_privilege('service_role', 'public.request_desk_requests', 'delete')`)).toBe("f");
        expect(value(`select has_function_privilege('service_role', 'public.request_desk_submit_form_request(uuid, text, text, text, text)', 'execute')`)).toBe("t");
        expect(value(`select has_function_privilege('service_role', 'public.request_desk_delete_expired_form_submissions(integer)', 'execute')`)).toBe("t");
        expect(value(`select relrowsecurity from pg_class where oid = 'public.request_desk_forms'::regclass`)).toBe("t");
    });
});
