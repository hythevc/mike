// SPDX-License-Identifier: AGPL-3.0-only
// The committed brand module is exactly what scripts/brand/generate.mjs
// writes for packages/brand/brand.json, so `npm test` catches a hand edit, or
// a brand.json change that was not regenerated. Only this test reads
// packages/brand; production code must not (architecture rule 10).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "../brand.generated";

const REPO = path.resolve(__dirname, "../../../..");
const read = (file: string) => readFileSync(path.join(REPO, file), "utf8");

type Generator = {
  renderModule(config: unknown, schema: unknown): string;
  resolveBrand(config: unknown, schema: unknown): unknown;
};

describe("lib/brand.generated.ts", () => {
  it("is the generator's output for packages/brand/brand.json", async () => {
    const generator = (await import(path.join(REPO, "scripts/brand/generate.mjs"))) as Generator;
    const config: unknown = JSON.parse(read("packages/brand/brand.json"));
    const schema: unknown = JSON.parse(read("packages/brand/brand.schema.json"));
    expect(read("backend/src/lib/brand.generated.ts")).toBe(generator.renderModule(config, schema));
    expect(brand).toEqual(generator.resolveBrand(config, schema));
  });
});
