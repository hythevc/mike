// SPDX-License-Identifier: AGPL-3.0-only
// Legal acceptances — implementation behind the user module facade.
//
// Onboarding is not complete until the user has accepted the current Terms
// and Privacy versions (the "gating" documents). This file records an
// acceptance, works out which gating documents a user still owes at their
// current version, and derives the sign-in method from the authenticated
// account. The current versions come from the single brand configuration.
import { brand, type BrandLegalDocumentKey } from "../../lib/brand.generated";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import { type Db } from "./user.shared";

/** The documents whose current version must be accepted to finish onboarding. */
export const GATING_LEGAL_DOCUMENTS = [
    "terms",
    "privacy",
] as const satisfies readonly BrandLegalDocumentKey[];

export type SignInMethod = "password" | "google" | "sso" | "unknown";

/** One accepted (document, version) pair from a request. */
export interface LegalAcceptanceInput {
    document: string;
    version: string;
}

/** Whether a string names a legal document in the brand configuration. */
export function isLegalDocumentKey(
    value: string,
): value is BrandLegalDocumentKey {
    return Object.hasOwn(brand.legalDocuments, value);
}

/** The current version of a gating document, from the brand configuration. */
function gatingVersions(): Record<string, string> {
    const versions: Record<string, string> = {};
    for (const key of GATING_LEGAL_DOCUMENTS) {
        versions[key] = brand.legalDocuments[key].version;
    }
    return versions;
}

interface SupabaseAuthUser {
    app_metadata?: { provider?: unknown } | null;
    identities?: Array<{ provider?: unknown } | null> | null;
}

/** Map a Supabase auth user to the sign-in method recorded with an acceptance. */
export function signInMethodFromUser(user: SupabaseAuthUser | null): SignInMethod {
    if (!user) return "unknown";
    const providers = new Set<string>();
    if (typeof user.app_metadata?.provider === "string") {
        providers.add(user.app_metadata.provider);
    }
    for (const identity of user.identities ?? []) {
        if (identity && typeof identity.provider === "string") {
            providers.add(identity.provider);
        }
    }
    if (providers.has("google")) return "google";
    for (const provider of providers) {
        if (provider === "sso" || provider.startsWith("sso:") || provider.startsWith("saml")) {
            return "sso";
        }
    }
    if (providers.has("email")) return "password";
    return "unknown";
}

/** Best-effort sign-in method for a user; "unknown" if it cannot be read. */
async function resolveSignInMethod(db: Db, userId: string): Promise<SignInMethod> {
    try {
        const { data, error } = await db.auth.admin.getUserById(userId);
        if (error) return "unknown";
        return signInMethodFromUser((data?.user ?? null) as SupabaseAuthUser | null);
    } catch {
        return "unknown";
    }
}

/**
 * The gating documents the user has not accepted at their current version.
 * Returns null when it cannot be determined (query error, or a database
 * without this table yet), so onboarding is not blocked by a transient
 * failure — the same fail-open stance as the onboarding version check.
 */
export async function loadOutstandingLegalAcceptances(
    db: Db,
    userId: string,
): Promise<{ outstanding: BrandLegalDocumentKey[] } | null> {
    const current = gatingVersions();
    try {
        const { data, error } = await db
            .from("user_legal_acceptances")
            .select("document, version")
            .eq("user_id", userId);
        if (error) return null;

        const accepted = new Map<string, Set<string>>();
        for (const row of (data ?? []) as {
            document: string;
            version: string;
        }[]) {
            const versions = accepted.get(row.document) ?? new Set<string>();
            versions.add(row.version);
            accepted.set(row.document, versions);
        }
        const outstanding = GATING_LEGAL_DOCUMENTS.filter(
            (key) => !accepted.get(key)?.has(current[key]),
        );
        return { outstanding: [...outstanding] };
    } catch {
        // Any failure (a database without this table yet, a transient error)
        // must not lock a user out: report nothing outstanding instead.
        return null;
    }
}

/** Parse and validate the POST body into the acceptances to record. */
export function parseLegalAcceptancePayload(
    body: unknown,
):
    | { ok: true; acceptances: LegalAcceptanceInput[] }
    | { ok: false; detail: string } {
    const raw = (body as { acceptances?: unknown })?.acceptances;
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, detail: "A non-empty acceptances array is required." };
    }
    if (raw.length > 32) {
        return { ok: false, detail: "Too many acceptances in one request." };
    }
    const acceptances: LegalAcceptanceInput[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        const document = (entry as { document?: unknown })?.document;
        const version = (entry as { version?: unknown })?.version;
        if (typeof document !== "string" || typeof version !== "string") {
            return { ok: false, detail: "Each acceptance needs a document and a version." };
        }
        if (seen.has(document)) continue;
        seen.add(document);
        acceptances.push({ document, version });
    }
    return { ok: true, acceptances };
}

/**
 * Record the user's acceptance of one or more legal documents. Each must name
 * a document in the brand configuration, at its current version; a stale
 * version is a conflict so the client re-reads and accepts the current one.
 * The sign-in method is derived from the account, not trusted from the client.
 */
export async function recordLegalAcceptances(
    db: Db,
    userId: string,
    acceptances: LegalAcceptanceInput[],
): Promise<ServiceResult<{ recorded: number; outstanding: BrandLegalDocumentKey[] }>> {
    if (acceptances.length === 0) {
        return failure("validation", "No documents to accept were given.");
    }
    for (const { document, version } of acceptances) {
        if (!isLegalDocumentKey(document)) {
            return failure("validation", `Unknown legal document: ${document}.`);
        }
        if (version !== brand.legalDocuments[document].version) {
            return failure(
                "conflict",
                `The ${document} document has changed. Reload the page and accept the current version.`,
            );
        }
    }

    const signInMethod = await resolveSignInMethod(db, userId);
    const { error } = await db.from("user_legal_acceptances").insert(
        acceptances.map(({ document, version }) => ({
            user_id: userId,
            document,
            version,
            sign_in_method: signInMethod,
        })),
    );
    if (error) return internalFailure(error);

    const outstanding = await loadOutstandingLegalAcceptances(db, userId);
    return ok({
        recorded: acceptances.length,
        outstanding: outstanding?.outstanding ?? [],
    });
}
