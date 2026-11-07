// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for the legal-skill converter and the catalog validator. Each of
// W16's acceptance criteria has a test here: the Apache fixture converts to a
// SKILL.md the real parser accepts; the untrusted-source and licence refusals
// each name the skill and the file; the lint rules fail unless a recorded
// edit removes them; conversion is byte-identical and --check reports drift;
// and validate:catalog passes the fixture catalog plus the five defaults and
// fails over the 8 MB budget.

import { createHash } from "crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  convertWorkflow,
  type ConvertContext,
  type EditsManifest,
  type WorkflowManifest,
} from "../convert";
import { GUARDRAIL_SENTENCES } from "../guardrail";
import { readSkillSource, SkillConversionError } from "../sourceReader";
import {
  buildCatalogFiles,
  checkCatalog,
  runConvert,
  type ConvertCatalogOptions,
} from "../../../jobs/convertLegalSkills";
import {
  CatalogSizeBudgetError,
  checkSizeBudget,
  validateCatalog,
} from "../../../jobs/validateWorkflowCatalog";

const FIXTURES = path.resolve(__dirname, "..", "__fixtures__");
const CONVERSION = path.join(FIXTURES, "conversion");
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(dir);
  return dir;
}

const CONTEXT: ConvertContext = {
  company: "Example Legal Ltd",
  catalogRepositoryUrl: "https://github.com/example/legal-workflows",
  releaseTag: "catalog-v2026.11.1",
  sourceCommit: "f9f28cdccbeb98bbdde010042ea9f525ca427c72",
  modifiedOn: "2026-10-31",
  docxDate: new Date("2026-10-31T00:00:00Z"),
};

function convertOptions(outRoot: string, check = false): ConvertCatalogOptions {
  return {
    sourceRoot: FIXTURES,
    conversionRoot: CONVERSION,
    outRoot,
    check,
    company: CONTEXT.company,
    catalogRepositoryUrl: CONTEXT.catalogRepositoryUrl,
    releaseTag: CONTEXT.releaseTag,
    sourceCommit: CONTEXT.sourceCommit,
    modifiedOn: CONTEXT.modifiedOn,
  };
}

const ROOT_LICENSE = `MIT License

Copyright (c) 2026 Mike

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction. THE SOFTWARE IS PROVIDED "AS IS".
`;

function defaultSkill(key: string, title: string, type: "assistant" | "tabular"): string {
  const body =
    type === "tabular"
      ? "Review the selected documents and return one row per document."
      : `Run the ${title} workflow on the selected documents.`;
  return `---
name: ${key}
description: Built-in ${title} workflow; its output is a draft for a lawyer to review. Draft for lawyer review.
license: MIT
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "${title}"
  mike-type: "${type}"
  mike-availability: "system"
  practice: "General Practice"
  jurisdictions: "General"
---
# ${title}

${body}
`;
}

const DEFAULT_COLUMNS = `columns:
  - index: 0
    name: "Issue"
    prompt: "Identify the issue and quote the clause."
  - index: 1
    name: "Points for lawyer review"
    prompt: "List the points a lawyer should check."
    format: "bulleted_list"
`;

/** Write Mike's five required default workflows and the root LICENSE. */
async function writeDefaults(outRoot: string): Promise<void> {
  await writeFile(path.join(outRoot, "LICENSE"), ROOT_LICENSE);
  const assistants: Array<[string, string]> = [
    ["proofread", "Proofread"],
    ["compare-documents", "Compare Documents"],
    ["extract-key-terms", "Extract Key Terms"],
    ["draft-from-template", "Draft From Template"],
  ];
  for (const [key, title] of assistants) {
    const dir = path.join(outRoot, "assistant-workflows", key);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), defaultSkill(key, title, "assistant"));
  }
  const tabularDir = path.join(
    outRoot,
    "tabular-review-workflows",
    "commercial-agreement-tabular-review",
  );
  await mkdir(tabularDir, { recursive: true });
  await writeFile(
    path.join(tabularDir, "SKILL.md"),
    defaultSkill("commercial-agreement-tabular-review", "Commercial Agreement Review", "tabular"),
  );
  await writeFile(path.join(tabularDir, "table-columns.yaml"), DEFAULT_COLUMNS);
}

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("convertWorkflow: Apache fixture (AC1)", () => {
  it("converts to a catalog entry the parser accepts, with flat assets, rewritten links, guardrails, a dated notice and the verbatim NOTICE", async () => {
    const outRoot = await tempDir("w16-convert-");
    const report = await runConvert(convertOptions(outRoot));
    const written = new Set(report.written);

    // No script files survive: scripts/ is dropped entirely.
    expect([...written].some((p) => p.includes("/scripts/") || p.endsWith(".py"))).toBe(false);

    const workflowDir = "assistant-workflows/contract-review-pack/opposing-counsel-review";
    const skill = await readFile(path.join(outRoot, workflowDir, "SKILL.md"), "utf8");

    // Flat DOCX asset, referenced as assets/<file>.docx (the upstream form).
    expect(written.has(`${workflowDir}/assets/ocr-playbook.docx`)).toBe(true);
    expect(skill).toContain("`assets/ocr-playbook.docx`");
    // The reference link was rewritten; no residual references/ path.
    expect(skill).not.toContain("references/playbook.md");
    expect(skill).not.toContain("references/positions.md");
    expect(skill).toContain("the appendix Fallback Language below");
    // The recorded edit was applied.
    expect(skill).toContain("Draft negotiation points for the lawyer to review.");
    // Guardrail block present.
    for (const sentence of GUARDRAIL_SENTENCES) expect(skill).toContain(sentence);
    expect(skill).toContain("## Copilot ground rules");
    expect(skill).toContain("## Output requirements");
    // Dated modification notice in the footer.
    expect(skill).toContain("## Attribution and licence");
    expect(skill).toContain("Modified by Example Legal Ltd on 2026-10-31");
    // The "Related skills" promotion section was deleted.
    expect(skill).not.toContain("Related skills");

    // NOTICE: upstream text verbatim plus our separate block.
    const notice = await readFile(path.join(outRoot, workflowDir, "NOTICE"), "utf8");
    expect(notice).toContain("This product includes the adversarial review method");
    expect(notice).toContain("Additional notices");
    expect(notice).toContain("Modified by Example Legal Ltd on 2026-10-31");

    // Licence, changes, provenance and the editable asset source all ship.
    expect(written.has(`${workflowDir}/LICENSE`)).toBe(true);
    expect(written.has(`${workflowDir}/CHANGES.md`)).toBe(true);
    expect(written.has(`${workflowDir}/PROVENANCE.yaml`)).toBe(true);
    expect(written.has(`${workflowDir}/source/ocr-playbook.md`)).toBe(true);

    // The whole catalog (fixture + five defaults) passes the real parser.
    await writeDefaults(outRoot);
    const validation = await validateCatalog({
      checkoutRoot: outRoot,
      temporaryRoot: await tempDir("w16-validate-"),
    });
    const converted = validation.document.workflows.find(
      (w) => w.workflow_key === "opposing-counsel-review",
    );
    expect(converted).toBeDefined();
    expect(converted?.license).toBe("Apache-2.0");
    expect(converted?.license_evidence).toBe("file");
    expect(converted?.pack_key).toBe("assistant:contract-review");
    expect(converted?.assets.map((a) => a.filename)).toEqual(["ocr-playbook.docx"]);
    expect(converted?.notice_md).toContain("Additional notices");
    // The five defaults are all present.
    expect(validation.document.workflows.length).toBe(6);
  });
});

function manifestFor(overrides: Partial<WorkflowManifest> = {}): WorkflowManifest {
  return {
    key: "opposing-counsel-review",
    displayName: "Opposing Counsel Review",
    sourceSkill: "opposing-counsel-review",
    collection: "assistant",
    pack: "contract-review",
    description:
      "Reviews a commercial contract from the other side's perspective and drafts negotiation points for each clause. Draft for lawyer review.",
    practice: "Commercial Contracts",
    jurisdictionCodes: ["ALL"],
    languageCode: "en",
    license: "Apache-2.0",
    licenseEvidence: "file",
    authorCredit: "Example Author",
    copyrightLines: ["Copyright 2026 Example Author"],
    originalTitle: "Opposing Counsel Review",
    upstreamVersion: "1.2.0",
    assetPrefix: "ocr",
    assets: [
      { from: "references/playbook.md", as: "docx", title: "Negotiation Playbook", purpose: "the playbook" },
      { from: "references/positions.md", as: "inline", title: "Fallback Language", purpose: "fallbacks" },
    ],
    webUse: "none",
    reviewBy: "2027-05-01",
    changeSummary: "converted to Mike format",
    ...overrides,
  };
}

async function loadFixtureSource(folder: string) {
  return readSkillSource(path.join(FIXTURES, "skills"), folder);
}

const NO_EDITS: EditsManifest = { edits: [] };

describe("refusals name the skill and the file (AC2)", () => {
  it("refuses a licence outside the allowlist", async () => {
    const source = await loadFixtureSource("opposing-counsel-review");
    await expect(
      convertWorkflow(source, manifestFor({ license: "GPL-3.0" }), NO_EDITS, CONTEXT),
    ).rejects.toThrow(/opposing-counsel-review.*allowlist/s);
  });

  it("refuses a manifest-only licence with no confirmation reference", async () => {
    const source = await loadFixtureSource("opposing-counsel-review");
    await expect(
      convertWorkflow(
        source,
        manifestFor({ licenseEvidence: "manifest-only", authorConfirmation: null }),
        NO_EDITS,
        CONTEXT,
      ),
    ).rejects.toThrow(/opposing-counsel-review.*manifest/s);
  });

  it("refuses a '..' path in an asset mapping", async () => {
    const source = await loadFixtureSource("opposing-counsel-review");
    await expect(
      convertWorkflow(
        source,
        manifestFor({
          assets: [{ from: "../escape.md", as: "inline", purpose: "x" }],
        }),
        NO_EDITS,
        CONTEXT,
      ),
    ).rejects.toThrow(/opposing-counsel-review.*escape\.md.*escapes the skill folder/s);
  });

  it("refuses a symlink in the source", async () => {
    const root = await tempDir("w16-symlink-");
    const folder = path.join(root, "skills", "sym-skill");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "SKILL.md"), "---\nname: sym-skill\n---\n# x\n");
    await symlink("/etc/hostname", path.join(folder, "link.md"));
    await expect(readSkillSource(path.join(root, "skills"), "sym-skill")).rejects.toThrow(
      /sym-skill.*link\.md.*symlink/s,
    );
  });

  it("refuses a hard link in the source", async () => {
    const root = await tempDir("w16-hardlink-");
    const folder = path.join(root, "skills", "hard-skill");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "SKILL.md"), "---\nname: hard-skill\n---\n# x\n");
    await writeFile(path.join(folder, "a.md"), "shared bytes");
    await link(path.join(folder, "a.md"), path.join(folder, "b.md"));
    await expect(readSkillSource(path.join(root, "skills"), "hard-skill")).rejects.toThrow(
      /hard-skill.*hard link/s,
    );
  });

  it("refuses a file over 5 MB", async () => {
    const root = await tempDir("w16-oversize-");
    const folder = path.join(root, "skills", "big-skill");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "SKILL.md"), "---\nname: big-skill\n---\n# x\n");
    await writeFile(path.join(folder, "big.md"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    await expect(readSkillSource(path.join(root, "skills"), "big-skill")).rejects.toThrow(
      /big-skill.*big\.md.*5 MB/s,
    );
  });
});

describe("lint fails unless a recorded edit removes the content (AC3)", () => {
  const lintManifest = manifestFor({
    key: "data-prep-helper",
    displayName: "Data Prep Helper",
    sourceSkill: "lint-skill",
    description:
      "Prepares the selected documents for review and lists the key points for a lawyer. Draft for lawyer review.",
    practice: "General Practice",
    jurisdictionCodes: ["US"],
    assetPrefix: undefined,
    assets: [],
    webUse: "optional",
  });

  it("refuses the unsafe instructions when no edit removes them", async () => {
    const source = await loadFixtureSource("lint-skill");
    await expect(convertWorkflow(source, lintManifest, NO_EDITS, CONTEXT)).rejects.toThrow(
      /data-prep-helper.*lint found content/s,
    );
  });

  it("passes once a recorded edit deletes the section", async () => {
    const source = await loadFixtureSource("lint-skill");
    const edits: EditsManifest = {
      edits: [
        {
          op: "deleteSection",
          heading: "Automated setup",
          reason: "removes run/install, agent-file writes, silent search, hidden work and MCP steering",
          category: "safety",
        },
      ],
    };
    const result = await convertWorkflow(source, lintManifest, edits, CONTEXT);
    const skill = result.files.get(
      "assistant-workflows/contract-review-pack/data-prep-helper/SKILL.md",
    )!;
    const text = skill.toString("utf8");
    expect(text).not.toContain("pip install");
    expect(text).not.toContain("CLAUDE.md");
    expect(text).not.toContain("MCP server");
    expect(text).not.toContain("Do not mention");
  });
});

describe("determinism and drift (AC4)", () => {
  it("produces byte-identical output across two runs", async () => {
    const first = await buildCatalogFiles(convertOptions(await tempDir("w16-det-a-")));
    const second = await buildCatalogFiles(convertOptions(await tempDir("w16-det-b-")));
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [key, bytes] of first) {
      expect(sha(second.get(key)!), `byte drift in ${key}`).toBe(sha(bytes));
    }
  });

  it("--check reports drift after a manual edit", async () => {
    const outRoot = await tempDir("w16-check-");
    await runConvert(convertOptions(outRoot));
    const skillPath = path.join(
      outRoot,
      "assistant-workflows/contract-review-pack/opposing-counsel-review/SKILL.md",
    );
    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\nedited by hand\n`);
    const files = await buildCatalogFiles(convertOptions(outRoot));
    const drift = await checkCatalog(outRoot, files);
    expect(drift.changed).toContain(
      "assistant-workflows/contract-review-pack/opposing-counsel-review/SKILL.md",
    );
  });
});

describe("catalog size budget (AC4)", () => {
  it("passes under 7 MB, warns between 7 and 8 MB, and fails over 8 MB", () => {
    expect(checkSizeBudget(6 * 1024 * 1024).warning).toBeNull();
    expect(checkSizeBudget(7.5 * 1024 * 1024).warning).toMatch(/approaching the 8 MB budget/);
    expect(() => checkSizeBudget(8.5 * 1024 * 1024)).toThrow(CatalogSizeBudgetError);
  });
});

describe("SkillConversionError", () => {
  it("names the skill and the file", () => {
    const error = new SkillConversionError("my-skill", "a/b.md", "is bad");
    expect(error.message).toBe("Skill 'my-skill', file 'a/b.md': is bad");
  });
});
