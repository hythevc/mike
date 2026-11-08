// SPDX-License-Identifier: AGPL-3.0-only
//
// The W18 matter-AI-controls migration in real PostgreSQL: a newly created
// MCP, Drive or Gmail connector requires write approval by default, while
// existing rows keep whatever they were set to (the migration changes only
// the column default).
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
// migration twice on top (it must be safe to re-run), and drops it at the end.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const serverUrl =
    process.env.MIKE_TEST_POSTGRES_URL || process.env.SUPABASE_TEST_DB_URL;
const database = `mike_matter_ai_${process.pid}_${Date.now()}`;
const MIGRATION = "20261107_51_matter_ai_controls.sql";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const U1 = 1;
const U2 = 2;

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
    return execFileSync(command, args, {
        input: text,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
    }).trim();
}

const migrationSql = () =>
    readFileSync(resolve(__dirname, "../../../migrations", MIGRATION), "utf8");

const value = (text: string) => sql(text);

// Minimal inserts into each connector table for one user; require_write_approval
// is left out so the row takes the column default.
function insertMcp(user: number, name: string): string {
    return `insert into public.user_mcp_connectors (user_id, name, server_url)
        values (${q(user)}, '${name}', 'https://example.com/mcp')`;
}
function insertDrive(user: number): string {
    return `insert into public.user_google_drive_tokens (user_id) values (${q(user)})`;
}
function insertGmail(user: number, provider: string): string {
    return `insert into public.user_google_workspace_tokens
        (user_id, provider, account_email, account_id,
         encrypted_access_token, access_token_iv, access_token_tag,
         encrypted_refresh_token, refresh_token_iv, refresh_token_tag,
         scope, expires_at)
        values (${q(user)}, '${provider}', 'x@example.com', 'acct',
         'x','x','x','x','x','x','drive', now())`;
}

describe.skipIf(!container && !serverUrl)("W18 matter AI controls migration", () => {
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
        const migration = migrationSql();
        sql(migration);
        sql(migration);
    }, 120_000);

    afterAll(() => {
        if (created) sql(`drop database if exists "${database}" with (force)`, "server");
    });

    beforeEach(() => {
        sql(`truncate auth.users,
            public.user_mcp_connectors,
            public.user_google_drive_tokens,
            public.user_google_workspace_tokens cascade;
            insert into auth.users (id, email) values
                (${q(U1)}, 'u1@firm.example'), (${q(U2)}, 'u2@firm.example');`);
    });

    it("projects gains the ai_restricted columns, defaulting to AI on", () => {
        sql(`insert into public.projects (user_id, name) values (${q(U1)}, 'Matter')`);
        expect(
            value(`select concat_ws('|',
                ai_restricted::text,
                coalesce(ai_restricted_reason, 'null'),
                coalesce(ai_restricted_by::text, 'null'),
                coalesce(ai_restricted_at::text, 'null'))
                from public.projects where name = 'Matter'`),
        ).toBe("false|null|null|null");
    });

    it("a newly created MCP, Drive or Gmail connector requires write approval by default", () => {
        sql(insertMcp(U1, "Slack"));
        sql(insertDrive(U1));
        sql(insertGmail(U1, "gmail"));
        expect(
            value(`select require_write_approval::text from public.user_mcp_connectors where user_id = ${q(U1)}`),
        ).toBe("true");
        expect(
            value(`select require_write_approval::text from public.user_google_drive_tokens where user_id = ${q(U1)}`),
        ).toBe("true");
        expect(
            value(`select require_write_approval::text from public.user_google_workspace_tokens where user_id = ${q(U1)}`),
        ).toBe("true");
    });

    it("a user can still turn write approval off when creating a connector", () => {
        sql(`insert into public.user_mcp_connectors (user_id, name, server_url, require_write_approval)
            values (${q(U1)}, 'Slack', 'https://example.com/mcp', false)`);
        expect(
            value(`select require_write_approval::text from public.user_mcp_connectors where user_id = ${q(U1)}`),
        ).toBe("false");
    });

    it("existing rows keep their value when the migration is applied", () => {
        // Simulate the pre-migration state: the default is false, and a
        // connector was created under it (so it reads false).
        sql(`alter table public.user_mcp_connectors alter column require_write_approval set default false;
            alter table public.user_google_drive_tokens alter column require_write_approval set default false;
            alter table public.user_google_workspace_tokens alter column require_write_approval set default false;`);
        sql(insertMcp(U1, "Old Slack"));
        sql(insertDrive(U1));
        sql(insertGmail(U1, "gmail"));

        // Apply the migration (idempotent): it flips the default to true.
        sql(migrationSql());

        // A connector created after the migration takes the new default...
        sql(insertMcp(U2, "New Slack"));
        sql(insertDrive(U2));
        sql(insertGmail(U2, "google-calendar"));

        // ...while the rows that already existed are untouched.
        expect(
            value(`select string_agg(require_write_approval::text, ',' order by name)
                from public.user_mcp_connectors`),
        ).toBe("true,false"); // New Slack (true), Old Slack (false)
        expect(
            value(`select require_write_approval::text from public.user_google_drive_tokens where user_id = ${q(U1)}`),
        ).toBe("false");
        expect(
            value(`select require_write_approval::text from public.user_google_drive_tokens where user_id = ${q(U2)}`),
        ).toBe("true");
        expect(
            value(`select require_write_approval::text from public.user_google_workspace_tokens where user_id = ${q(U1)}`),
        ).toBe("false");
        expect(
            value(`select require_write_approval::text from public.user_google_workspace_tokens where user_id = ${q(U2)}`),
        ).toBe("true");
    });
});
