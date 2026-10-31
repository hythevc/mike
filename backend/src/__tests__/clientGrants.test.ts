// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The browser never queries the database directly: it reaches data through
// the API, which uses the service role after checking the user. A table the
// browser roles (anon, authenticated) can read or write is therefore a hole
// around every permission check the backend makes. Supabase grants those
// roles everything on a new table by default, so a table is only closed if
// its migration says so.
//
// The convention, for every table added after the baseline below:
//   - row level security is enabled (no policies: defense in depth, the
//     service role bypasses it), and
//   - all privileges are revoked from anon and authenticated,
// both in backend/schema.sql and in the migration that creates the table,
// and no later statement grants the browser roles anything on it.
// ---------------------------------------------------------------------------

/**
 * Tables that predate this check and rely on the revoke alone, without row
 * level security. Recorded when the check was introduced; the list may only
 * shrink. Every other table, including every table added since, needs both.
 */
const TABLES_WITHOUT_RLS_AT_BASELINE = new Set([
    "chat_messages",
    "chats",
    "document_edits",
    "document_versions",
    "documents",
    "hidden_workflows",
    "library_folders",
    "mike_workflow_assets",
    "mike_workflows",
    "project_subfolders",
    "projects",
    "tabular_cells",
    "tabular_review_chat_messages",
    "tabular_review_chats",
    "tabular_reviews",
    "user_profiles",
    "workflow_addons",
    "workflow_shares",
    "workflows",
]);

/** The newest migration when the check was introduced. Later ones are checked one by one. */
const BASELINE_MIGRATION = "20261029_01_chat_overview_candidates.sql";

const BROWSER_ROLES = ["anon", "authenticated"] as const;

/** SQL without comments, so prose that quotes a statement is not read as one. */
function withoutComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function listOf(text: string): string[] {
    return text
        .split(",")
        .map((item) => item.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean);
}

/** `public.name`, `name` or `table public.name`, normalized to `name`. */
function tableName(object: string): string | null {
    const match = object.match(/^(?:table\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?$/);
    return match ? match[1] : null;
}

/**
 * Every way `sql` leaves a table it creates open to the browser roles, one
 * line per problem. A table is checked against the statements in the same
 * text, so a migration has to close its own tables.
 */
function clientGrantViolations(
    sql: string,
    baseline: ReadonlySet<string> = TABLES_WITHOUT_RLS_AT_BASELINE,
): string[] {
    const text = withoutComments(sql).toLowerCase();
    const created = new Set(
        [...text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/g)].map(
            (match) => match[1],
        ),
    );
    const rls = new Set(
        [...text.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/g)].map(
            (match) => match[1],
        ),
    );
    const revoked = new Set<string>();
    for (const match of text.matchAll(/revoke\s+all(?:\s+privileges)?\s+on\s+([\s\S]*?)\s+from\s+([\s\S]*?);/g)) {
        const roles = listOf(match[2]);
        if (!BROWSER_ROLES.every((role) => roles.includes(role))) continue;
        for (const object of listOf(match[1])) {
            const name = tableName(object);
            if (name) revoked.add(name);
        }
    }
    const regranted = new Set<string>();
    for (const match of text.matchAll(/grant\s+[\s\S]*?\s+on\s+([\s\S]*?)\s+to\s+([\s\S]*?);/g)) {
        const roles = listOf(match[2]);
        if (!roles.some((role) => (BROWSER_ROLES as readonly string[]).includes(role) || role === "public")) continue;
        for (const object of listOf(match[1])) {
            const name = tableName(object);
            if (name) regranted.add(name);
        }
    }

    const violations: string[] = [];
    for (const table of [...created].sort()) {
        if (!rls.has(table) && !baseline.has(table)) {
            violations.push(`${table}: row level security is not enabled`);
        }
        if (!revoked.has(table)) {
            violations.push(`${table}: privileges are not revoked from anon and authenticated`);
        }
        if (regranted.has(table)) {
            violations.push(`${table}: privileges are granted to a browser role`);
        }
    }
    return violations;
}

const backendRoot = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(backendRoot, "schema.sql"), "utf8");
const laterMigrations = readdirSync(path.join(backendRoot, "migrations"))
    .filter((file) => file.endsWith(".sql") && file > BASELINE_MIGRATION)
    .sort();

describe("browser roles have no direct access to backend tables", () => {
    it("finds the tables it is meant to be checking", () => {
        const tables = [...withoutComments(schema).matchAll(/create\s+table\s+/gi)];
        expect(tables.length).toBeGreaterThan(70);
    });

    it("holds for every table in schema.sql", () => {
        expect(
            clientGrantViolations(schema),
            "enable row level security and `revoke all on public.<table> from public, anon, authenticated;` for the new table",
        ).toEqual([]);
    });

    it.each(laterMigrations.length ? laterMigrations : ["(none yet)"])(
        "holds for the tables migration %s creates",
        (file) => {
            if (file === "(none yet)") return;
            const sql = readFileSync(path.join(backendRoot, "migrations", file), "utf8");
            expect(clientGrantViolations(sql)).toEqual([]);
        },
    );

    it("keeps the baseline to tables that still exist without row level security", () => {
        const text = withoutComments(schema).toLowerCase();
        for (const table of TABLES_WITHOUT_RLS_AT_BASELINE) {
            expect(text, `${table} is gone: remove it from the baseline`).toMatch(
                new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(`),
            );
            expect(
                text,
                `${table} now enables row level security: remove it from the baseline`,
            ).not.toMatch(
                new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?public\\.${table}\\s+enable\\s+row\\s+level\\s+security`),
            );
        }
    });
});

describe("clientGrantViolations", () => {
    const closed = `
        create table if not exists public.fixture_ledger (id uuid primary key);
        alter table public.fixture_ledger enable row level security;
        revoke all on public.fixture_ledger from public, anon, authenticated;
        grant select, insert on public.fixture_ledger to service_role;
    `;

    it("accepts a new table that enables RLS and revokes the browser roles", () => {
        expect(clientGrantViolations(closed)).toEqual([]);
        expect(clientGrantViolations(`${schema}\n${closed}`)).toEqual([]);
    });

    it("fails a new table that lacks the revoke", () => {
        const fixture = `
            create table if not exists public.fixture_ledger (id uuid primary key);
            alter table public.fixture_ledger enable row level security;
            -- revoke all on public.fixture_ledger from anon, authenticated;
            grant select on public.fixture_ledger to service_role;
        `;
        expect(clientGrantViolations(`${schema}\n${fixture}`)).toEqual([
            "fixture_ledger: privileges are not revoked from anon and authenticated",
        ]);
    });

    it("fails a revoke that leaves one browser role in place", () => {
        const fixture = `
            create table public.fixture_ledger (id uuid primary key);
            alter table public.fixture_ledger enable row level security;
            revoke all on public.fixture_ledger from anon;
        `;
        expect(clientGrantViolations(fixture)).toEqual([
            "fixture_ledger: privileges are not revoked from anon and authenticated",
        ]);
    });

    it("fails a new table without row level security", () => {
        const fixture = `
            create table public.fixture_ledger (id uuid primary key);
            revoke all privileges on table public.fixture_ledger from anon, authenticated;
        `;
        expect(clientGrantViolations(fixture)).toEqual([
            "fixture_ledger: row level security is not enabled",
        ]);
    });

    it("fails a table granted back to a browser role", () => {
        expect(
            clientGrantViolations(`${closed}\ngrant select on public.fixture_ledger to authenticated;`),
        ).toEqual(["fixture_ledger: privileges are granted to a browser role"]);
    });
});
