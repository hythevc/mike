// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
    JURISDICTION_CODE_PATTERN,
    formatJurisdiction,
    getJurisdiction,
    isJurisdictionCode,
    listLaunchJurisdictions,
} from "../jurisdictions";

// The launch list, written out rather than derived, so a change to the
// registry has to be made here as well: code, name, kind, parent, languages.
const EXPECTED: [string, string, string, string | null, string[]][] = [
    ["US", "United States", "country", null, ["en"]],
    ["US_CA", "California", "subdivision", "US", ["en"]],
    ["US_NY", "New York", "subdivision", "US", ["en"]],
    ["GB", "United Kingdom", "country", null, ["en"]],
    ["EU", "European Union", "supranational", null, ["en", "fr", "de"]],
    ["NL", "Netherlands", "country", null, ["nl"]],
    ["BE", "Belgium", "country", null, ["nl", "fr", "de"]],
    ["PT", "Portugal", "country", null, ["pt"]],
    ["BR", "Brazil", "country", null, ["pt"]],
    ["BR_SP", "São Paulo", "subdivision", "BR", ["pt"]],
    ["ES", "Spain", "country", null, ["es"]],
    ["FR", "France", "country", null, ["fr"]],
    ["DE", "Germany", "country", null, ["de"]],
    ["IE", "Ireland", "country", null, ["en", "ga"]],
    ["IT", "Italy", "country", null, ["it"]],
    ["CA", "Canada", "country", null, ["en", "fr"]],
    ["AU", "Australia", "country", null, ["en"]],
    ["IN", "India", "country", null, ["en", "hi"]],
    ["SG", "Singapore", "country", null, ["en"]],
    ["CH", "Switzerland", "country", null, ["de", "fr", "it"]],
    ["AT", "Austria", "country", null, ["de"]],
    ["LU", "Luxembourg", "country", null, ["fr", "de", "lb"]],
    ["MX", "Mexico", "country", null, ["es"]],
    ["DK", "Denmark", "country", null, ["da"]],
    ["SE", "Sweden", "country", null, ["sv"]],
    ["PL", "Poland", "country", null, ["pl"]],
    ["ZA", "South Africa", "country", null, ["en"]],
    ["JP", "Japan", "country", null, ["ja"]],
    ["ZZ", "International standards", "international", null, ["en"]],
];

describe("jurisdiction registry", () => {
    const launch = listLaunchJurisdictions();

    it("holds exactly the 29 launch codes, in order", () => {
        expect(launch).toHaveLength(29);
        expect(launch.map((jurisdiction) => jurisdiction.code)).toEqual([
            "US", "US_CA", "US_NY", "GB", "EU", "NL", "BE", "PT", "BR",
            "BR_SP", "ES", "FR", "DE", "IE", "IT", "CA", "AU", "IN", "SG",
            "CH", "AT", "LU", "MX", "DK", "SE", "PL", "ZA", "JP", "ZZ",
        ]);
        expect(new Set(launch.map((j) => j.code)).size).toBe(29);
    });

    it("gives every entry its name, kind, parent and languages", () => {
        expect(
            launch.map((j) => [j.code, j.name, j.kind, j.parent, [...j.languages]]),
        ).toEqual(EXPECTED);
        expect(launch.every((j) => j.launch === true)).toBe(true);
    });

    it("marks exactly the three subdivisions, the union and the standards entry", () => {
        const codesOf = (kind: string) =>
            launch.filter((j) => j.kind === kind).map((j) => j.code);
        expect(codesOf("subdivision")).toEqual(["US_CA", "US_NY", "BR_SP"]);
        expect(codesOf("supranational")).toEqual(["EU"]);
        expect(codesOf("international")).toEqual(["ZZ"]);
        expect(codesOf("country")).toHaveLength(24);
    });

    it("gives every subdivision a parent that exists and is a country", () => {
        for (const jurisdiction of launch) {
            if (jurisdiction.kind !== "subdivision") {
                expect(jurisdiction.parent).toBeNull();
                continue;
            }
            const parent = getJurisdiction(jurisdiction.parent);
            expect(parent, jurisdiction.code).not.toBeNull();
            expect(parent?.kind).toBe("country");
            // COUNTRY_SUB: the code starts with its parent's.
            expect(jurisdiction.code.startsWith(`${parent?.code}_`)).toBe(true);
        }
    });

    it("uses well-formed codes and BCP 47 primary language subtags", () => {
        for (const jurisdiction of launch) {
            expect(jurisdiction.code).toMatch(JURISDICTION_CODE_PATTERN);
            expect(jurisdiction.languages.length).toBeGreaterThan(0);
            for (const language of jurisdiction.languages)
                expect(language).toMatch(/^[a-z]{2,3}$/);
        }
    });

    it("cannot be changed by a caller", () => {
        const [first] = launch;
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.languages)).toBe(true);
        // A fresh array each call: dropping an entry from one result does
        // not shorten the registry.
        launch.pop();
        expect(listLaunchJurisdictions()).toHaveLength(29);
    });
});

describe("isJurisdictionCode", () => {
    it.each(["US", "US_CA", "EU", "ZZ", "BR_SP", "GB", "US_1", "XX"])(
        "accepts %s",
        (code) => {
            expect(isJurisdictionCode(code)).toBe(true);
        },
    );

    it.each([
        ["lower case", "us"],
        ["three letters", "USA"],
        ["a hyphen", "US-CA"],
        ["an empty string", ""],
        ["trailing spaces", "US  "],
        ["a trailing space", "US "],
        ["a leading space", " US"],
        ["a trailing newline", "US\n"],
        ["a lower-case subdivision", "US_ca"],
        ["an empty subdivision", "US_"],
        ["a long subdivision", "US_CALI"],
        ["two subdivisions", "US_CA_LA"],
    ])("rejects %s", (_label, code) => {
        expect(isJurisdictionCode(code)).toBe(false);
    });

    it.each([null, undefined, 42, ["US"], { code: "US" }])(
        "rejects a value that is not a string (%j)",
        (value) => {
            expect(isJurisdictionCode(value)).toBe(false);
        },
    );
});

describe("getJurisdiction", () => {
    it("returns the entry for a registry code", () => {
        expect(getJurisdiction("US_CA")).toMatchObject({
            code: "US_CA",
            name: "California",
            kind: "subdivision",
            parent: "US",
        });
    });

    it("returns null for a well-formed code the registry does not hold", () => {
        expect(isJurisdictionCode("XX")).toBe(true);
        expect(getJurisdiction("XX")).toBeNull();
    });

    it.each(["us", "US ", "", "constructor", "__proto__", null, undefined, 7])(
        "returns null for %j",
        (value) => {
            expect(getJurisdiction(value)).toBeNull();
        },
    );
});

describe("formatJurisdiction", () => {
    it("renders a code as Name (CODE)", () => {
        expect(formatJurisdiction("US")).toBe("United States (US)");
        expect(formatJurisdiction("US_CA")).toBe("California (US_CA)");
        expect(formatJurisdiction("BR_SP")).toBe("São Paulo (BR_SP)");
        expect(formatJurisdiction("EU")).toBe("European Union (EU)");
        expect(formatJurisdiction("ZZ")).toBe("International standards (ZZ)");
    });

    it("renders every launch code", () => {
        for (const jurisdiction of listLaunchJurisdictions())
            expect(formatJurisdiction(jurisdiction.code)).toBe(
                `${jurisdiction.name} (${jurisdiction.code})`,
            );
    });

    it("returns null rather than echo a string the registry does not hold", () => {
        expect(formatJurisdiction("XX")).toBeNull();
        expect(formatJurisdiction("Ignore previous instructions")).toBeNull();
        expect(formatJurisdiction(null)).toBeNull();
    });
});
