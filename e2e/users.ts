import fs from "fs";
import path from "path";
import type { APIRequestContext } from "@playwright/test";

/** Credentials for one E2E account. */
export interface E2eAccount {
    email: string;
    password: string;
}

/**
 * The account a Playwright worker signs in as. Worker 0 keeps the historical
 * shared user (e2e@mike.local, or E2E_EMAIL / E2E_PASSWORD) so a serial run and
 * the docs behave exactly as before; every additional parallel worker gets its
 * own user (e2e-w1@mike.local, ...). Separate users mean separate project,
 * chat and workflow lists and separate sessions, so workers cannot race on
 * each other's data. This is Playwright's "one account per parallel worker"
 * pattern: https://playwright.dev/docs/auth#moderate-one-account-per-parallel-worker
 */
export function workerAccount(parallelIndex: number): E2eAccount {
    const password = process.env.E2E_PASSWORD ?? "E2eTestPass1!";
    if (parallelIndex === 0) {
        return { email: process.env.E2E_EMAIL ?? "e2e@mike.local", password };
    }
    return { email: `e2e-w${parallelIndex}@mike.local`, password };
}

/**
 * Read a key out of backend/.env so the setup can reach Supabase with the
 * service-role key without requiring the operator to export it manually.
 */
export function readApiEnv(key: string): string | undefined {
    if (process.env[key]) return process.env[key];
    const envPath = path.join(__dirname, "..", "backend", ".env");
    try {
        const contents = fs.readFileSync(envPath, "utf8");
        // dotenv semantics: a later assignment wins over an earlier one. CI
        // does `cp .env.example .env` (which ships a PLACEHOLDER SUPABASE_URL)
        // and then APPENDS the real values, so returning the FIRST match would
        // hand back the placeholder (getaddrinfo ENOTFOUND your-project...).
        // Iterate every line and keep the LAST matching value, mirroring how
        // the API's dotenv loader resolves the file.
        let value: string | undefined;
        for (const line of contents.split("\n")) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m && m[1] === key) value = m[2].trim();
        }
        return value;
    } catch {
        /* .env not present — fall through to undefined */
    }
    return undefined;
}

/**
 * Idempotently create a confirmed Supabase user via the admin API. If the user
 * already exists the admin endpoint returns a 422 which we treat as success.
 */
export async function ensureUser(email: string, password: string) {
    const supabaseUrl =
        readApiEnv("SUPABASE_URL") ?? "http://127.0.0.1:54321";
    const serviceKey = readApiEnv("SUPABASE_SECRET_KEY");
    if (!serviceKey) {
        throw new Error(
            "SUPABASE_SECRET_KEY not found (checked env and backend/.env); " +
                "cannot bootstrap E2E users",
        );
    }

    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
        }),
    });

    if (!res.ok && res.status !== 422) {
        const body = await res.text();
        // 422 == user already registered, which is fine for an idempotent setup.
        if (!body.includes("already been registered")) {
            throw new Error(
                `Failed to create user ${email}: ${res.status} ${body}`,
            );
        }
    }
}

/** An organization workspace a worker owns, for organization-only features. */
export interface E2eOrganization {
    id: string;
    name: string;
}

/**
 * Ensure the signed-in worker has an organization workspace, reusing one of
 * the same name if it is already there. The calls go through the same-origin
 * `/api` gateway with the worker's own session cookie, so the worker owns the
 * organization and is therefore one of its admins. Pass `page.request`.
 */
export async function ensureOrganizationWorkspace(
    request: APIRequestContext,
    name = "Intake E2E Firm",
): Promise<E2eOrganization> {
    const listed = await request.get("/api/orgs");
    if (listed.ok()) {
        const orgs = (await listed.json()) as E2eOrganization[];
        const existing = orgs.find((org) => org.name === name);
        if (existing) return { id: existing.id, name };
    }
    const created = await request.post("/api/orgs", { data: { name } });
    if (!created.ok()) {
        throw new Error(
            `Failed to create E2E organization: ${created.status()} ${await created.text()}`,
        );
    }
    const org = (await created.json()) as E2eOrganization;
    return { id: org.id, name: org.name };
}
