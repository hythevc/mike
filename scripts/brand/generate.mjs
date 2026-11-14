// SPDX-License-Identifier: AGPL-3.0-only
// Brand module generator.
//
// packages/brand/brand.json is the single source of the product's name,
// addresses, legal documents and marks. No application reads packages/ at
// runtime: the Docker images, the desktop stack and the Word add-in each
// build from their own tree. So this script validates brand.json against
// packages/brand/brand.schema.json and writes the same TypeScript module into
// each application that needs it:
//
//   frontend/src/shared/brand.generated.ts   the web app, and the Word add-in
//                                            through its @mike/brand alias
//   backend/src/lib/brand.generated.ts       the API, workers and jobs
//
// Both modules are committed. scripts/brand/generate.test.mjs fails while
// either one differs from what this script produces for brand.json.
//
// Usage (from the repository root):
//   node scripts/brand/generate.mjs           validate brand.json, write both modules
//   node scripts/brand/generate.mjs --check   validate; exit 1 if a module is out of date
//   --root <dir>                              work on another checkout (used by the tests)
//
// Dependency-free on purpose, like the other scripts here: CI runs it before
// any npm install.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BRAND_FILE = "packages/brand/brand.json";
export const SCHEMA_FILE = "packages/brand/brand.schema.json";
export const OUTPUT_FILES = [
    "frontend/src/shared/brand.generated.ts",
    "backend/src/lib/brand.generated.ts",
];

/** WCAG 2 AA for normal text. */
export const MIN_CONTRAST = 4.5;

export class BrandConfigError extends Error {
    constructor(problems) {
        super(`${BRAND_FILE} is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
        this.name = "BrandConfigError";
        this.problems = problems;
    }
}

const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const fieldPath = (parent, key) => (parent ? `${parent}.${key}` : key);

function resolveRef(root, ref) {
    const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
    const target = match ? root.$defs?.[match[1]] : undefined;
    if (!target) throw new Error(`${SCHEMA_FILE}: unresolvable $ref ${ref}`);
    return target;
}

/** "A mailbox address." -> "a mailbox address", for error messages. */
function formatHint(description) {
    if (typeof description !== "string" || !description) return "";
    const text = description.replace(/\.$/, "");
    return ` (${text.charAt(0).toLowerCase()}${text.slice(1)})`;
}

function shown(value) {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Validate a value against the subset of JSON Schema 2020-12 the brand schema
 * uses (type, enum, required, properties, additionalProperties: false, $ref
 * to $defs, minLength, maxLength, pattern). Returns one message per failed
 * rule, each starting with the dotted path of the field it is about.
 */
export function validateAgainstSchema(schema, value, root = schema, path = "") {
    const at = path || "brand config";
    const problems = [];
    if (schema.$ref) {
        problems.push(...validateAgainstSchema(resolveRef(root, schema.$ref), value, root, path));
    }
    if (schema.enum && !schema.enum.includes(value)) {
        problems.push(
            `${at} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}; found ${shown(value)}`,
        );
    }
    if (schema.type) {
        const matches = schema.type === "object" ? isObject(value) : typeof value === schema.type;
        if (!matches) {
            problems.push(`${at} must be ${schema.type === "object" ? "an object" : `a ${schema.type}`}; found ${shown(value)}`);
            return problems;
        }
    }
    if (typeof value === "string") {
        const length = [...value].length;
        if (schema.minLength !== undefined && length < schema.minLength) {
            problems.push(
                schema.minLength === 1
                    ? `${at} must not be empty`
                    : `${at} must be at least ${schema.minLength} characters; it has ${length}`,
            );
        }
        if (schema.maxLength !== undefined && length > schema.maxLength) {
            problems.push(`${at} must be at most ${schema.maxLength} characters; it has ${length}`);
        }
        // The schema holding the pattern describes the format it expects.
        if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
            problems.push(
                `${at} does not match the expected format${formatHint(schema.description)}; found ${shown(value)}`,
            );
        }
    }
    if (isObject(value) && (schema.properties || schema.required || schema.additionalProperties === false)) {
        for (const key of schema.required ?? []) {
            if (!Object.hasOwn(value, key)) problems.push(`${fieldPath(path, key)} is required`);
        }
        for (const [key, entry] of Object.entries(value)) {
            const child = schema.properties?.[key];
            if (child) {
                problems.push(...validateAgainstSchema(child, entry, root, fieldPath(path, key)));
            } else if (schema.additionalProperties === false) {
                problems.push(`${fieldPath(path, key)} is not a known field`);
            }
        }
    }
    return problems;
}

function channel(hex, offset) {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a #RRGGBB colour. */
function luminance(hex) {
    return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2 contrast ratio between two #RRGGBB colours, from 1 to 21. */
export function contrastRatio(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/** Order keys as the schema lists them and drop the editor-only `$` keys. */
function inSchemaOrder(schema, value, root) {
    const node = schema.$ref ? resolveRef(root, schema.$ref) : schema;
    if (!isObject(value) || !node.properties) return value;
    const out = {};
    for (const key of Object.keys(node.properties)) {
        if (key.startsWith("$") || !Object.hasOwn(value, key)) continue;
        out[key] = inSchemaOrder(node.properties[key], value[key], root);
    }
    return out;
}

/** brand.json with its documented defaults applied, in schema order. */
export function resolveBrand(config, schema) {
    const assistantName = config.assistantName ?? `${config.productName} Assistant`;
    return inSchemaOrder(
        schema,
        { ...config, assistantName, docxAuthorLabel: config.docxAuthorLabel ?? assistantName },
        schema,
    );
}

/**
 * Every problem with a brand config: schema violations in the file as
 * written and in its resolved form (the defaults must fit the schema too),
 * then the checks a schema cannot express.
 */
export function brandProblems(config, schema) {
    const problems = validateAgainstSchema(schema, config);
    if (problems.length) return problems;
    const resolved = resolveBrand(config, schema);
    for (const problem of validateAgainstSchema(schema, resolved)) {
        if (!problems.includes(problem)) problems.push(problem);
    }
    const { primary, onPrimary, primaryDark } = resolved.palette;
    const ratio = contrastRatio(primary, onPrimary);
    if (ratio < MIN_CONTRAST) {
        problems.push(
            `palette.onPrimary has a contrast of ${ratio.toFixed(2)}:1 on palette.primary; it must be at least ${MIN_CONTRAST}:1`,
        );
    }
    // The optional dark-surface brand fill still carries on-brand text, so
    // onPrimary must clear 4.5:1 on it too. Its 3:1 boundary against the dark
    // app surface is checked in the web app's tokenContrast.test.ts.
    if (primaryDark !== undefined) {
        const darkRatio = contrastRatio(primaryDark, onPrimary);
        if (darkRatio < MIN_CONTRAST) {
            problems.push(
                `palette.onPrimary has a contrast of ${darkRatio.toFixed(2)}:1 on palette.primaryDark; it must be at least ${MIN_CONTRAST}:1`,
            );
        }
    }
    return problems;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// Optional config fields resolveBrand always fills, so they are present in
// every generated value and stay required in the generated type. Keep this in
// step with resolveBrand's defaults.
const ALWAYS_RESOLVED = new Set(["assistantName", "docxAuthorLabel"]);

function wrapComment(text, indent) {
    const width = 80 - indent.length - 4;
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines.length === 1
        ? [`${indent}/** ${lines[0]} */`]
        : [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`];
}

function renderType(schema, root, indent, named) {
    if (schema.$ref) {
        const name = /([A-Za-z0-9_]+)$/.exec(schema.$ref)[1];
        const target = resolveRef(root, schema.$ref);
        if (target.type === "object") {
            const typeName = `Brand${pascal(name)}`;
            if (!named.has(typeName)) {
                named.set(typeName, null);
                named.set(typeName, renderType(target, root, "", named));
            }
            return typeName;
        }
        return renderType(target, root, indent, named);
    }
    if (schema.enum) return schema.enum.map((option) => JSON.stringify(option)).join(" | ");
    if (schema.type !== "object") return schema.type;
    const lines = ["{"];
    const required = new Set(schema.required ?? []);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key.startsWith("$")) continue;
        if (child.description) lines.push(...wrapComment(child.description, `${indent}  `));
        const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
        // A property the config may omit and the resolver does not fill (today
        // only palette.primaryDark) is optional in the type; everything in
        // `required`, and the two defaults resolveBrand always supplies, stays
        // mandatory.
        const optional =
            required.has(key) || ALWAYS_RESOLVED.has(key) ? "" : "?";
        lines.push(
            `${indent}  readonly ${name}${optional}: ${renderType(child, root, `${indent}  `, named)};`,
        );
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
}

function renderValue(value, indent) {
    if (!isObject(value)) return JSON.stringify(value);
    const lines = ["{"];
    for (const [key, entry] of Object.entries(value)) {
        const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
        lines.push(`${indent}  ${name}: ${renderValue(entry, `${indent}  `)},`);
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
}

/** The TypeScript module both applications commit, for a valid config. */
export function renderModule(config, schema) {
    const problems = brandProblems(config, schema);
    if (problems.length) throw new BrandConfigError(problems);
    const named = new Map();
    const brandType = renderType(schema, schema, "", named);
    const out = [
        "// SPDX-License-Identifier: AGPL-3.0-only",
        `// Generated by scripts/brand/generate.mjs from ${BRAND_FILE}.`,
        "// Do not edit by hand: change brand.json, then run",
        "// `node scripts/brand/generate.mjs`. scripts/brand/generate.test.mjs fails",
        "// while this file and brand.json disagree.",
        "",
    ];
    for (const [typeName, body] of named) {
        out.push(`export interface ${typeName} ${body}`, "");
    }
    out.push(
        ...wrapComment(schema.description, ""),
        `export interface Brand ${brandType}`,
        "",
        "/** The key of each legal document in brand.legalDocuments. */",
        'export type BrandLegalDocumentKey = keyof Brand["legalDocuments"];',
        "",
        `export const brand: Brand = ${renderValue(resolveBrand(config, schema), "")};`,
        "",
    );
    return out.join("\n");
}

function readJson(root, file) {
    try {
        return JSON.parse(readFileSync(join(root, file), "utf8"));
    } catch (error) {
        throw new Error(`${file} could not be read as JSON: ${error.message}`);
    }
}

/**
 * Validate brand.json and write (or, with check, compare) every generated
 * module. Returns the files that were written or found out of date.
 */
export function generate({ root = REPO_ROOT, check = false } = {}) {
    const schema = readJson(root, SCHEMA_FILE);
    const config = readJson(root, BRAND_FILE);
    const module = renderModule(config, schema);
    const changed = [];
    for (const file of OUTPUT_FILES) {
        let current = null;
        try {
            current = readFileSync(join(root, file), "utf8");
        } catch {
            current = null;
        }
        if (current === module) continue;
        changed.push(file);
        if (!check) writeFileSync(join(root, file), module);
    }
    return changed;
}

function main(argv) {
    const check = argv.includes("--check");
    const rootIndex = argv.indexOf("--root");
    const root = rootIndex >= 0 ? resolve(argv[rootIndex + 1] ?? "") : REPO_ROOT;
    try {
        const changed = generate({ root, check });
        if (check && changed.length) {
            console.error(
                `Out of date with ${BRAND_FILE}: ${changed.join(", ")}.\n` +
                    "Run `node scripts/brand/generate.mjs` and commit the result.",
            );
            return 1;
        }
        console.log(
            check
                ? "Brand modules match brand.json."
                : changed.length
                  ? `Wrote ${changed.join(", ")}.`
                  : "Brand modules already match brand.json.",
        );
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    process.exitCode = main(process.argv.slice(2));
}
