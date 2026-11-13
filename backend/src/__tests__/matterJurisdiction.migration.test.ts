// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    JURISDICTION_CODE_PATTERN,
    listLaunchJurisdictions,
} from "../lib/jurisdictions";

// The matter jurisdiction migration (L1) adds columns and check constraints
// to two existing tables. Whether Postgres accepts it, and whether applying
// it twice is harmless, is proved against a real database by
// integration/matterJurisdiction.postgres.test.ts and by the schema-drift
// workflow. What can be held without a database is the part a reviewer
// would otherwise check by eye: the file is numbered and dated as agreed,
// every statement in it is written to be re-run, and schema.sql (the shape
// a fresh install gets) declares the same columns and the same constraints.
//
// Scope, stated plainly: this reads SQL text. It does not execute it.

const repoRoot = path.resolve(__dirname, "../../..");
const MIGRATION = "20261113_50_matter_jurisdiction.sql";

function withoutComments(sql: string): string {
    return sql.replace(/--[^\n]*/g, " ");
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const rawMigration = readFileSync(
    path.join(repoRoot, "backend/migrations", MIGRATION),
    "utf8",
);
const migration = withoutComments(rawMigration);
const schema = withoutComments(
    readFileSync(path.join(repoRoot, "backend/schema.sql"), "utf8"),
);

/** The body of `create table if not exists public.<table> ( ... );`. */
function createTableBody(table: string): string {
    const start = schema.indexOf(`create table if not exists public.${table} (`);
    expect(start, `schema.sql creates public.${table}`).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf("\n);", start));
}

/** The text between the parentheses that open at `open`, balanced. */
function balanced(text: string, open: number): string {
    let depth = 0;
    for (let index = open; index < text.length; index++) {
        if (text[index] === "(") depth++;
        else if (text[index] === ")" && --depth === 0)
            return text.slice(open + 1, index);
    }
    throw new Error("unbalanced parentheses");
}

/** Every `constraint <name> check (<expression>)` in `sql`, by name. */
function checkConstraints(sql: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const match of sql.matchAll(/constraint\s+(\w+)\s+check\s*\(/g)) {
        const open = match.index + match[0].length - 1;
        found.set(match[1], collapse(balanced(sql, open)));
    }
    return found;
}

/** Every `add column if not exists <name> <definition>` in the migration. */
function addedColumns(table: string): Map<string, string> {
    const columns = new Map<string, string>();
    const statement = new RegExp(
        `alter table public\\.${table}\\s+((?:add column[^;]*))`,
        "g",
    );
    for (const match of migration.matchAll(statement)) {
        for (const clause of match[1].split(/,\s*(?=add column)/)) {
            const column = clause.match(
                /^add column if not exists (\w+)\s+([\s\S]+)$/,
            );
            expect(column, `re-runnable column clause: ${clause}`).not.toBeNull();
            columns.set(column![1], collapse(column![2]));
        }
    }
    return columns;
}

/** A column's definition line inside a create table body, up to a constraint. */
function schemaColumn(body: string, name: string): string | null {
    const match = body.match(
        new RegExp(`\\n\\s+${name}\\s+([^\\n]*?),?\\s*(?=\\n)`),
    );
    return match ? collapse(match[1]) : null;
}

const EXPECTED_COLUMNS: Record<string, Record<string, string>> = {
    projects: {
        jurisdictions: "text[] not null default '{}'",
        governing_law: "text",
        working_language: "text",
    },
    organizations: {
        default_jurisdictions: "text[] not null default '{}'",
        default_working_language: "text",
    },
};

const EXPECTED_CONSTRAINTS: Record<string, Record<string, string>> = {
    projects: {
        projects_jurisdictions_limit: "cardinality(jurisdictions) <= 10",
        projects_governing_law_format:
            "governing_law is null or governing_law ~ '^[A-Z]{2}(_[A-Z0-9]{1,3})?$'",
    },
    organizations: {
        organizations_default_jurisdictions_limit:
            "cardinality(default_jurisdictions) <= 10",
    },
};

describe("matter jurisdiction migration", () => {
    it("takes the agreed slot and no other file shares it", () => {
        const slot = readdirSync(path.join(repoRoot, "backend/migrations")).filter(
            (file) => file.startsWith("20261113_50_"),
        );
        expect(slot).toEqual([MIGRATION]);
    });

    it("starts with the licence line and the migration date", () => {
        const lines = rawMigration.split("\n");
        expect(lines[0]).toBe("-- SPDX-License-Identifier: AGPL-3.0-only");
        expect(lines[1]).toBe("-- Migration date: 2026-11-13");
    });

    it("leaves the transaction to the runner", () => {
        expect(migration).not.toMatch(/\b(begin|commit|rollback)\s*;/i);
        expect(rawMigration).not.toContain("migrate:no-transaction");
    });

    it.each(Object.keys(EXPECTED_COLUMNS))(
        "adds the %s columns so that a second run changes nothing",
        (table) => {
            expect(Object.fromEntries(addedColumns(table))).toEqual(
                EXPECTED_COLUMNS[table],
            );
            // No column is added without the guard.
            expect(migration).not.toMatch(/add column (?!if not exists)/);
        },
    );

    it("drops each constraint before adding it", () => {
        const added = [...migration.matchAll(/add constraint (\w+)/g)].map(
            (match) => match[1],
        );
        expect(added.sort()).toEqual(
            Object.values(EXPECTED_CONSTRAINTS)
                .flatMap((constraints) => Object.keys(constraints))
                .sort(),
        );
        for (const name of added) {
            const drop = migration.indexOf(`drop constraint if exists ${name};`);
            expect(drop, `drop constraint if exists ${name}`).toBeGreaterThan(-1);
            expect(drop).toBeLessThan(migration.indexOf(`add constraint ${name}`));
        }
    });

    it("declares the constraints as written here", () => {
        const constraints = checkConstraints(migration);
        for (const expected of Object.values(EXPECTED_CONSTRAINTS))
            for (const [name, expression] of Object.entries(expected))
                expect(constraints.get(name), name).toBe(expression);
    });

    it("changes nothing else", () => {
        const statements = migration
            .split(";")
            .map(collapse)
            .filter(Boolean);
        for (const statement of statements)
            expect(statement).toMatch(
                /^alter table public\.(projects|organizations) (add column|drop constraint if exists|add constraint) /,
            );
    });
});

describe("schema.sql agrees with the matter jurisdiction migration", () => {
    it.each(Object.keys(EXPECTED_COLUMNS))(
        "creates public.%s with the same columns",
        (table) => {
            const body = createTableBody(table);
            for (const [name, definition] of Object.entries(
                EXPECTED_COLUMNS[table],
            ))
                expect(schemaColumn(body, name), `${table}.${name}`).toBe(
                    definition,
                );
        },
    );

    it.each(Object.keys(EXPECTED_CONSTRAINTS))(
        "creates public.%s with the same constraints",
        (table) => {
            const inSchema = checkConstraints(createTableBody(table));
            const inMigration = checkConstraints(migration);
            for (const name of Object.keys(EXPECTED_CONSTRAINTS[table])) {
                expect(inSchema.get(name), name).toBeDefined();
                expect(inSchema.get(name), name).toBe(inMigration.get(name));
            }
        },
    );

    it("records the migration in the ledger", () => {
        expect(schema).toContain(`('${MIGRATION}')`);
    });
});

describe("the jurisdiction code shape is the same in SQL and in the registry", () => {
    it("uses the registry's pattern in the governing-law constraint", () => {
        const expression = checkConstraints(migration).get(
            "projects_governing_law_format",
        );
        const sqlPattern = expression?.match(/~ '([^']+)'/)?.[1];
        expect(sqlPattern).toBeDefined();
        // POSIX and JavaScript agree on this pattern's syntax; a capturing
        // group and a non-capturing one match the same strings.
        expect(sqlPattern).toBe(
            JURISDICTION_CODE_PATTERN.source.replace("(?:", "("),
        );
        const sqlRegex = new RegExp(sqlPattern!);
        for (const { code } of listLaunchJurisdictions())
            expect(sqlRegex.test(code), code).toBe(true);
        for (const refused of ["us", "USA", "US-CA", "", "US "])
            expect(sqlRegex.test(refused), JSON.stringify(refused)).toBe(false);
    });
});
