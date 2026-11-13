// SPDX-License-Identifier: AGPL-3.0-only
//
// Jurisdiction registry: the canonical list of jurisdictions a matter can be
// about. Shared kernel: the projects and organisations modules validate
// against it, the chat engine names jurisdictions from it, and the pickers
// in the web app are served from it.
//
// A code is an upper-case ISO 3166-1 alpha-2 country code. A subdivision is
// COUNTRY_SUB with an underscore (US_CA). Two codes are not countries: EU is
// the European Union and ZZ stands for international standards.
//
// The database stores codes and checks only their shape and number, so
// adding a jurisdiction here needs no migration.

export type JurisdictionKind =
    | "country"
    | "subdivision"
    | "supranational"
    | "international";

export type Jurisdiction = {
    readonly code: string;
    /** English name. */
    readonly name: string;
    readonly kind: JurisdictionKind;
    /** The country a subdivision belongs to; null for everything else. */
    readonly parent: string | null;
    /** Primary languages, as BCP 47 primary language subtags. */
    readonly languages: readonly string[];
    /** Offered in pickers and accepted on matters. */
    readonly launch: boolean;
};

/** The shape of a code. Membership is a separate question: getJurisdiction. */
export const JURISDICTION_CODE_PATTERN = /^[A-Z]{2}(?:_[A-Z0-9]{1,3})?$/;

function entry(
    code: string,
    name: string,
    languages: readonly string[],
    kind: JurisdictionKind = "country",
    parent: string | null = null,
): Jurisdiction {
    return Object.freeze({
        code,
        name,
        kind,
        parent,
        languages: Object.freeze([...languages]),
        launch: true,
    });
}

const REGISTRY: readonly Jurisdiction[] = Object.freeze([
    entry("US", "United States", ["en"]),
    entry("US_CA", "California", ["en"], "subdivision", "US"),
    entry("US_NY", "New York", ["en"], "subdivision", "US"),
    entry("GB", "United Kingdom", ["en"]),
    entry("EU", "European Union", ["en", "fr", "de"], "supranational"),
    entry("NL", "Netherlands", ["nl"]),
    entry("BE", "Belgium", ["nl", "fr", "de"]),
    entry("PT", "Portugal", ["pt"]),
    entry("BR", "Brazil", ["pt"]),
    entry("BR_SP", "São Paulo", ["pt"], "subdivision", "BR"),
    entry("ES", "Spain", ["es"]),
    entry("FR", "France", ["fr"]),
    entry("DE", "Germany", ["de"]),
    entry("IE", "Ireland", ["en", "ga"]),
    entry("IT", "Italy", ["it"]),
    entry("CA", "Canada", ["en", "fr"]),
    entry("AU", "Australia", ["en"]),
    entry("IN", "India", ["en", "hi"]),
    entry("SG", "Singapore", ["en"]),
    entry("CH", "Switzerland", ["de", "fr", "it"]),
    entry("AT", "Austria", ["de"]),
    entry("LU", "Luxembourg", ["fr", "de", "lb"]),
    entry("MX", "Mexico", ["es"]),
    entry("DK", "Denmark", ["da"]),
    entry("SE", "Sweden", ["sv"]),
    entry("PL", "Poland", ["pl"]),
    entry("ZA", "South Africa", ["en"]),
    entry("JP", "Japan", ["ja"]),
    entry("ZZ", "International standards", ["en"], "international"),
]);

const BY_CODE: ReadonlyMap<string, Jurisdiction> = new Map(
    REGISTRY.map((jurisdiction) => [jurisdiction.code, jurisdiction]),
);

/**
 * Whether `value` has the shape of a jurisdiction code. Exact: no trimming
 * and no case folding, so `us`, `US-CA` and `US ` are all refused. A
 * well-formed code is not necessarily in the registry.
 */
export function isJurisdictionCode(value: unknown): value is string {
    return typeof value === "string" && JURISDICTION_CODE_PATTERN.test(value);
}

/** The registry entry for `code`, or null when the registry has none. */
export function getJurisdiction(code: unknown): Jurisdiction | null {
    return typeof code === "string" ? (BY_CODE.get(code) ?? null) : null;
}

/** Every jurisdiction offered at launch, in registry order. */
export function listLaunchJurisdictions(): Jurisdiction[] {
    return REGISTRY.filter((jurisdiction) => jurisdiction.launch);
}

/**
 * `Name (CODE)` for a registry code, the form used wherever a jurisdiction
 * is named to a person or a model. Null for anything the registry does not
 * hold, so a caller can never print a string it did not get from here.
 */
export function formatJurisdiction(code: unknown): string | null {
    const jurisdiction = getJurisdiction(code);
    return jurisdiction ? `${jurisdiction.name} (${jurisdiction.code})` : null;
}
