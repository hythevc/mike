// SPDX-License-Identifier: AGPL-3.0-only
//
// Matter jurisdiction profile.
//
// A matter (project) can record which jurisdictions it is about, which law
// governs it and which language it is worked in. An organisation can set the
// jurisdictions and the language its new matters start with. This file owns
// what the two share: what a valid value is, the codes a refusal carries,
// the shape a stored row is read into, and the read the chat engine uses to
// tell the model about the matter a conversation belongs to.
//
// The profile is context, not a control: nothing here decides who may open
// a matter or whether a model may run on it.

import type {
    MatterJurisdictionProfile,
    OrgMatterDefaults,
} from "@mike/contracts";
import {
    formatJurisdiction,
    getJurisdiction,
    isJurisdictionCode,
} from "./jurisdictions";
import { RESPONSE_LANGUAGES, responseLanguageName } from "./responseLanguages";
import type { Db } from "./supabase";

export type { MatterJurisdictionProfile, OrgMatterDefaults };

/** The most jurisdictions one matter, or one organisation default, may list. */
export const MAX_PROFILE_JURISDICTIONS = 10;

// Codes a client acts on. Each one is listed in CODE_KINDS
// (frontend/src/shared/lib/userError.ts).
export const INVALID_JURISDICTION_CODE = "invalid_jurisdiction";
export const TOO_MANY_JURISDICTIONS_CODE = "too_many_jurisdictions";
export const INVALID_WORKING_LANGUAGE_CODE = "invalid_working_language";

/** A refused value: the stable code, and a sentence written for the user. */
export type ProfileFieldFailure = { ok: false; code: string; detail: string };

type Parsed<T> = { ok: true; value: T } | ProfileFieldFailure;

function refuse(code: string, detail: string): ProfileFieldFailure {
    return { ok: false, code, detail };
}

/**
 * A list of registry codes: duplicates dropped, order kept. `null` clears
 * the list. Anything that is not a registry code is refused, exactly as
 * written: no trimming and no case folding.
 */
export function parseJurisdictionList(
    value: unknown,
    label: string,
): Parsed<string[]> {
    if (value === null) return { ok: true, value: [] };
    if (!Array.isArray(value))
        return refuse(
            INVALID_JURISDICTION_CODE,
            `${label} must be a list of jurisdiction codes.`,
        );
    const codes: string[] = [];
    for (const item of value as unknown[]) {
        const code = getJurisdiction(item)?.code;
        if (!code)
            return refuse(INVALID_JURISDICTION_CODE, unknownCodeDetail(item, label));
        if (!codes.includes(code)) codes.push(code);
    }
    if (codes.length > MAX_PROFILE_JURISDICTIONS)
        return refuse(
            TOO_MANY_JURISDICTIONS_CODE,
            `Choose at most ${MAX_PROFILE_JURISDICTIONS} jurisdictions.`,
        );
    return { ok: true, value: codes };
}

/** One registry code. `null` and the empty string both clear the value. */
export function parseJurisdiction(
    value: unknown,
    label: string,
): Parsed<string | null> {
    if (value === null || value === "") return { ok: true, value: null };
    const code = getJurisdiction(value)?.code;
    if (!code)
        return refuse(INVALID_JURISDICTION_CODE, unknownCodeDetail(value, label));
    return { ok: true, value: code };
}

/**
 * A language from the response-language list. `null` and the empty string
 * both clear the value. `auto` is a personal preference, not a language, so
 * it is refused here.
 */
export function parseWorkingLanguage(
    value: unknown,
    label: string,
): Parsed<string | null> {
    if (value === null || value === "") return { ok: true, value: null };
    if (!isWorkingLanguage(value))
        return refuse(
            INVALID_WORKING_LANGUAGE_CODE,
            `${label} must be one of the supported languages.`,
        );
    return { ok: true, value };
}

export function isWorkingLanguage(value: unknown): value is string {
    return (
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(RESPONSE_LANGUAGES, value)
    );
}

// Only a well-formed code is quoted back: the sentence is shown to the
// user, and anything else could be arbitrary text of any length.
function unknownCodeDetail(value: unknown, label: string): string {
    return isJurisdictionCode(value)
        ? `${value} is not a supported jurisdiction.`
        : `${label} must use supported jurisdiction codes.`;
}

/**
 * The profile fields present in a request body, validated. A field left out
 * stays out of the result, so a caller can tell "leave as it is" from
 * "clear it".
 */
export function parseMatterJurisdictionFields(body: {
    jurisdictions?: unknown;
    governing_law?: unknown;
    working_language?: unknown;
}):
    | { ok: true; fields: Partial<MatterJurisdictionProfile> }
    | ProfileFieldFailure {
    const fields: Partial<MatterJurisdictionProfile> = {};
    if (body.jurisdictions !== undefined) {
        const parsed = parseJurisdictionList(body.jurisdictions, "Jurisdictions");
        if (!parsed.ok) return parsed;
        fields.jurisdictions = parsed.value;
    }
    if (body.governing_law !== undefined) {
        const parsed = parseJurisdiction(body.governing_law, "Governing law");
        if (!parsed.ok) return parsed;
        fields.governing_law = parsed.value;
    }
    if (body.working_language !== undefined) {
        const parsed = parseWorkingLanguage(
            body.working_language,
            "Working language",
        );
        if (!parsed.ok) return parsed;
        fields.working_language = parsed.value;
    }
    return { ok: true, fields };
}

/** The organisation defaults present in a request body, validated. */
export function parseOrgMatterDefaultFields(body: {
    default_jurisdictions?: unknown;
    default_working_language?: unknown;
}): { ok: true; fields: Partial<OrgMatterDefaults> } | ProfileFieldFailure {
    const fields: Partial<OrgMatterDefaults> = {};
    if (body.default_jurisdictions !== undefined) {
        const parsed = parseJurisdictionList(
            body.default_jurisdictions,
            "Default jurisdictions",
        );
        if (!parsed.ok) return parsed;
        fields.default_jurisdictions = parsed.value;
    }
    if (body.default_working_language !== undefined) {
        const parsed = parseWorkingLanguage(
            body.default_working_language,
            "Default working language",
        );
        if (!parsed.ok) return parsed;
        fields.default_working_language = parsed.value;
    }
    return { ok: true, fields };
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A projects row's profile, as stored, in a stable shape. A row read from a
 * database that predates the columns has none of them and reads as empty.
 */
export function matterJurisdictionProfileOf(
    row: unknown,
): MatterJurisdictionProfile {
    const source = (row ?? {}) as Record<string, unknown>;
    return {
        jurisdictions: stringList(source.jurisdictions),
        governing_law: stringOrNull(source.governing_law),
        working_language: stringOrNull(source.working_language),
    };
}

/** An organizations row's defaults, as stored, in a stable shape. */
export function orgMatterDefaultsOf(row: unknown): OrgMatterDefaults {
    const source = (row ?? {}) as Record<string, unknown>;
    return {
        default_jurisdictions: stringList(source.default_jurisdictions),
        default_working_language: stringOrNull(source.default_working_language),
    };
}

/**
 * The stored values that are still valid today: registry codes only, within
 * the limit, and a language the response-language list still has. What is
 * copied onto a new matter, or named to a model, goes through this, so a
 * value that has since left a list is never propagated.
 */
export function currentMatterJurisdictionProfile(
    profile: MatterJurisdictionProfile,
): MatterJurisdictionProfile {
    return {
        jurisdictions: [...new Set(profile.jurisdictions)]
            .filter((code) => getJurisdiction(code) !== null)
            .slice(0, MAX_PROFILE_JURISDICTIONS),
        governing_law: getJurisdiction(profile.governing_law)
            ? profile.governing_law
            : null,
        working_language: isWorkingLanguage(profile.working_language)
            ? profile.working_language
            : null,
    };
}

export function isEmptyMatterJurisdictionProfile(
    profile: MatterJurisdictionProfile,
): boolean {
    return (
        profile.jurisdictions.length === 0 &&
        profile.governing_law === null &&
        profile.working_language === null
    );
}

/** The profile in words: what a person or a model is shown. */
export type MatterJurisdictionFacts = {
    /** Each as `Name (CODE)`. */
    jurisdictions: string[];
    /** `Name (CODE)`, or null. */
    governingLaw: string | null;
    /** The language's English name, or null. */
    workingLanguage: string | null;
};

/**
 * The profile as the model is told it: jurisdictions as `Name (CODE)` and
 * the language by its English name, each from the server's own tables and
 * never from the stored string. Null when nothing valid is recorded.
 */
export function matterJurisdictionFacts(
    profile: MatterJurisdictionProfile | null | undefined,
): MatterJurisdictionFacts | null {
    if (!profile) return null;
    const current = currentMatterJurisdictionProfile(
        matterJurisdictionProfileOf(profile),
    );
    if (isEmptyMatterJurisdictionProfile(current)) return null;
    return {
        jurisdictions: current.jurisdictions.flatMap(
            (code) => formatJurisdiction(code) ?? [],
        ),
        governingLaw: formatJurisdiction(current.governing_law),
        workingLanguage: responseLanguageName(
            current.working_language ?? undefined,
        ),
    };
}

// SQLSTATE and PostgREST codes are fixed vocabulary; anything else a driver
// calls `code` could be free text and stays out of the log line.
const SAFE_CODE = /^[A-Za-z0-9_]{2,40}$/;

/**
 * The profile of the matter a conversation runs in, for the model's context.
 * Null when there is no matter or it cannot be read: these facts tailor an
 * answer and never gate one, so a failed read costs the context, not the
 * turn.
 */
export async function loadMatterJurisdictionProfile(
    db: Db,
    projectId: string | null | undefined,
): Promise<MatterJurisdictionProfile | null> {
    if (!projectId) return null;
    try {
        const { data, error } = await db
            .from("projects")
            .select("jurisdictions, governing_law, working_language")
            .eq("id", projectId)
            .maybeSingle();
        if (error) {
            warnProfileUnread((error as { code?: unknown }).code);
            return null;
        }
        return data ? matterJurisdictionProfileOf(data) : null;
    } catch {
        warnProfileUnread(undefined);
        return null;
    }
}

function warnProfileUnread(code: unknown): void {
    console.warn(
        "[matter-profile] jurisdiction profile not read; continuing without it",
        typeof code === "string" && SAFE_CODE.test(code) ? { code } : {},
    );
}
