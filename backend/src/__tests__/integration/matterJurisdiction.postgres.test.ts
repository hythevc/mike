// SPDX-License-Identifier: AGPL-3.0-only
//
// The matter jurisdiction migration (L1) in real PostgreSQL: the columns and
// constraints it adds to projects and organizations, that applying it again
// changes nothing and loses nothing, and that a database upgraded by it ends
// with the same columns and constraints as one created from schema.sql.
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
// Every mode creates its own database, loads schema.sql into it, and drops
// it at the end.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const serverUrl =
    process.env.MIKE_TEST_POSTGRES_URL || process.env.SUPABASE_TEST_DB_URL;
const database = `mike_matter_jurisdiction_${process.pid}_${Date.now()}`;
const MIGRATION = "20261113_50_matter_jurisdiction.sql";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number) => `'${uid(n)}'`;
const U1 = 1;
const P1 = 101;
const P2 = 102;
const O1 = 201;
const O2 = 202;

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

const TEN = ["US", "US_CA", "US_NY", "GB", "EU", "NL", "BE", "PT", "BR", "BR_SP"];
const array = (codes: string[]) =>
    `array[${codes.map((code) => `'${code}'`).join(",")}]::text[]`;

const COLUMNS: [string, string][] = [
    ["projects", "jurisdictions"],
    ["projects", "governing_law"],
    ["projects", "working_language"],
    ["organizations", "default_jurisdictions"],
    ["organizations", "default_working_language"],
];
const CONSTRAINTS = [
    "projects_jurisdictions_limit",
    "projects_governing_law_format",
    "organizations_default_jurisdictions_limit",
];

/** The new columns and constraints as the catalog describes them. */
function shape(): string {
    const columns = sql(`
        select concat_ws('|', table_name, column_name, udt_name, is_nullable,
                         coalesce(column_default, 'no default'))
        from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (${COLUMNS.map(
              ([table, column]) => `('${table}', '${column}')`,
          ).join(", ")})
        order by table_name, column_name`);
    const constraints = sql(`
        select concat_ws('|', conrelid::regclass::text, conname,
                         pg_get_constraintdef(oid))
        from pg_constraint
        where conname in (${CONSTRAINTS.map((name) => `'${name}'`).join(", ")})
        order by conname`);
    return `${columns}\n${constraints}`;
}

/** A database from before the migration: none of its columns or constraints. */
function dropProfile(): void {
    sql(`alter table public.projects
            drop column if exists jurisdictions,
            drop column if exists governing_law,
            drop column if exists working_language;
         alter table public.organizations
            drop column if exists default_jurisdictions,
            drop column if exists default_working_language;`);
}

describe.skipIf(!container && !serverUrl)("matter jurisdiction migration", () => {
    let created = false;
    let freshShape = "";

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
        // What a fresh install has, before any migration runs on top of it.
        freshShape = shape();
    }, 120_000);

    afterAll(() => {
        if (created) sql(`drop database if exists "${database}" with (force)`, "server");
    });

    beforeEach(() => {
        sql(`truncate public.projects, public.organizations cascade;
            truncate auth.users cascade;
            insert into auth.users (id, email) values (${q(U1)}, 'u1@firm.example');`);
    });

    it("a fresh install has all five columns and all three constraints", () => {
        expect(freshShape.split("\n")).toHaveLength(8);
        for (const [table, column] of COLUMNS)
            expect(freshShape).toContain(`${table}|${column}|`);
        for (const name of CONSTRAINTS) expect(freshShape).toContain(`|${name}|`);
    });

    it("applies on top of a fresh install, twice, without changing its shape", () => {
        sql(migrationSql());
        sql(migrationSql());
        expect(shape()).toBe(freshShape);
    });

    it("gives a new matter and a new organization nothing recorded", () => {
        sql(`insert into public.projects (id, user_id, name) values (${q(P1)}, ${q(U1)}, 'Matter');
             insert into public.organizations (id, name) values (${q(O1)}, 'Firm');`);
        expect(
            sql(`select concat_ws('|', jurisdictions::text,
                    coalesce(governing_law, 'null'), coalesce(working_language, 'null'))
                 from public.projects where id = ${q(P1)}`),
        ).toBe("{}|null|null");
        expect(
            sql(`select concat_ws('|', default_jurisdictions::text,
                    coalesce(default_working_language, 'null'))
                 from public.organizations where id = ${q(O1)}`),
        ).toBe("{}|null");
    });

    it("stores a profile and keeps the order of its jurisdictions", () => {
        sql(`insert into public.projects (id, user_id, name, jurisdictions, governing_law, working_language)
             values (${q(P1)}, ${q(U1)}, 'Matter', ${array(["PT", "EU", "BR_SP"])}, 'PT', 'pt-PT');
             insert into public.organizations (id, name, default_jurisdictions, default_working_language)
             values (${q(O1)}, 'Firm', ${array(["US", "US_NY"])}, 'en-US');`);
        expect(
            sql(`select concat_ws('|', jurisdictions::text, governing_law, working_language)
                 from public.projects where id = ${q(P1)}`),
        ).toBe("{PT,EU,BR_SP}|PT|pt-PT");
        expect(
            sql(`select concat_ws('|', default_jurisdictions::text, default_working_language)
                 from public.organizations where id = ${q(O1)}`),
        ).toBe("{US,US_NY}|en-US");
    });

    it("accepts ten jurisdictions and refuses an eleventh", () => {
        sql(`insert into public.projects (id, user_id, name, jurisdictions)
             values (${q(P1)}, ${q(U1)}, 'Ten', ${array(TEN)});
             insert into public.organizations (id, name, default_jurisdictions)
             values (${q(O1)}, 'Ten', ${array(TEN)});`);
        expect(() =>
            sql(`insert into public.projects (id, user_id, name, jurisdictions)
                 values (${q(P2)}, ${q(U1)}, 'Eleven', ${array([...TEN, "ES"])})`),
        ).toThrow(/projects_jurisdictions_limit/);
        expect(() =>
            sql(`update public.projects set jurisdictions = ${array([...TEN, "ES"])}
                 where id = ${q(P1)}`),
        ).toThrow(/projects_jurisdictions_limit/);
        expect(() =>
            sql(`insert into public.organizations (id, name, default_jurisdictions)
                 values (${q(O2)}, 'Eleven', ${array([...TEN, "ES"])})`),
        ).toThrow(/organizations_default_jurisdictions_limit/);
    });

    it.each(["US", "US_CA", "EU", "ZZ", "BR_SP"])(
        "accepts %s as a governing law",
        (code) => {
            sql(`insert into public.projects (id, user_id, name, governing_law)
                 values (${q(P1)}, ${q(U1)}, 'Matter', '${code}')`);
            expect(
                sql(`select governing_law from public.projects where id = ${q(P1)}`),
            ).toBe(code);
        },
    );

    it.each(["us", "USA", "US-CA", "", "US ", "England and Wales"])(
        "refuses %j as a governing law",
        (value) => {
            expect(() =>
                sql(`insert into public.projects (id, user_id, name, governing_law)
                     values (${q(P1)}, ${q(U1)}, 'Matter', '${value}')`),
            ).toThrow(/projects_governing_law_format/);
        },
    );

    describe("on a database from before the migration", () => {
        beforeEach(() => {
            dropProfile();
            // Rows that exist before the columns do.
            sql(`insert into public.projects (id, user_id, name) values (${q(P1)}, ${q(U1)}, 'Old matter');
                 insert into public.organizations (id, name) values (${q(O1)}, 'Old firm');`);
        });

        it("really is without the columns before it runs", () => {
            expect(shape().trim()).toBe("");
        });

        it("ends with the shape a fresh install has", () => {
            sql(migrationSql());
            expect(shape()).toBe(freshShape);
        });

        it("leaves existing rows with nothing recorded", () => {
            sql(migrationSql());
            expect(
                sql(`select concat_ws('|', jurisdictions::text,
                        coalesce(governing_law, 'null'), coalesce(working_language, 'null'))
                     from public.projects where id = ${q(P1)}`),
            ).toBe("{}|null|null");
            expect(
                sql(`select concat_ws('|', default_jurisdictions::text,
                        coalesce(default_working_language, 'null'))
                     from public.organizations where id = ${q(O1)}`),
            ).toBe("{}|null");
        });

        it("keeps what has been recorded when it runs again", () => {
            sql(migrationSql());
            sql(`update public.projects
                    set jurisdictions = ${array(["GB", "IE"])}, governing_law = 'GB', working_language = 'en-GB'
                    where id = ${q(P1)};
                 update public.organizations
                    set default_jurisdictions = ${array(["GB"])}, default_working_language = 'en-GB'
                    where id = ${q(O1)};`);
            sql(migrationSql());
            sql(migrationSql());
            expect(shape()).toBe(freshShape);
            expect(
                sql(`select concat_ws('|', jurisdictions::text, governing_law, working_language)
                     from public.projects where id = ${q(P1)}`),
            ).toBe("{GB,IE}|GB|en-GB");
            expect(
                sql(`select concat_ws('|', default_jurisdictions::text, default_working_language)
                     from public.organizations where id = ${q(O1)}`),
            ).toBe("{GB}|en-GB");
        });
    });
});
