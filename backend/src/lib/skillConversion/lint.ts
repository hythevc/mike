// SPDX-License-Identifier: AGPL-3.0-only
//
// The lint gate over a converted workflow body. It runs on the source-derived
// text, after the declared edits and the mechanical transforms and before the
// fixed guardrail texts and footer are added, so a rule can only be cleared by
// a recorded edit that removes the offending text — never by the converter's
// own appended blocks. A failure names the skill and quotes what it matched.

import { SkillConversionError } from "./sourceReader";

type LintRule = {
  id: string;
  description: string;
  pattern: RegExp;
};

// Each rule is a reason a converted body is refused. The patterns are written
// to catch the upstream phrasings while leaving ordinary legal prose alone;
// the converter's own guardrail block, output requirements and footer are not
// scanned, so their mentions of web search or approval never trip a rule.
const LINT_RULES: LintRule[] = [
  {
    id: "run-or-install",
    description: "an instruction to run code or install packages",
    pattern:
      /\b(?:pip3?|pipx|uvx?|npm|npx|pnpm|yarn|gem|cargo|apt(?:-get)?|brew)\s+(?:install|add)\b|\bgo\s+get\b|\b(?:run|execute)\s+(?:the\s+)?(?:script|following command|this command)\b|\bpython3?\s+\S+\.py\b|\b(?:bash|sh|node|npx)\s+\S+\.(?:sh|js|mjs|ts|py)\b/i,
  },
  {
    id: "agent-instruction-file",
    description: "a write to an agent instruction file",
    pattern: /\b(?:CLAUDE|AGENTS|GEMINI)\.md\b|\.cursorrules\b|\bsettings\.json\b/i,
  },
  {
    id: "silent-web-search",
    description: "a silent or automatic web search",
    pattern:
      /\b(?:silently|quietly|automatically|in the background|without (?:telling|asking|notifying|informing))\b[^.\n]{0,48}\b(?:search|look up|browse|fetch|google|go online)\b|\b(?:search|look up|browse|google|go online)\b[^.\n]{0,48}\b(?:silently|quietly|automatically|in the background|without (?:telling|asking|notifying|informing))\b/i,
  },
  {
    id: "hide-from-user",
    description: "an instruction to hide work from the user",
    pattern:
      /\bdo not mention\b[^.\n]{0,40}\bto the user\b|\bdon'?t (?:tell|mention (?:this )?to|reveal to|disclose to) the user\b|\b(?:without|do not) (?:telling|disclos\w+|reveal\w+|mention\w+)[^.\n]{0,20}\bthe user\b/i,
  },
  {
    id: "vendor-or-mcp-steering",
    description: "vendor or MCP steering",
    pattern: /\bMCP\b|\bmodel context protocol\b/i,
  },
  {
    id: "fixed-external-fetch",
    description: "a fixed external fetch URL",
    pattern:
      /\b(?:fetch|download|retrieve|GET|curl|wget|load|pull|scrape)\b[^.\n]{0,48}https?:\/\//i,
  },
  {
    id: "credential-collection",
    description: "credential collection",
    pattern:
      /\b(?:ask|prompt|request|enter|provide|paste|collect|supply|input)\b[^.\n]{0,36}\b(?:api[ _-]?key|api token|access token|secret key|secret token|password|bearer token|credentials?)\b|\b(?:api[ _-]?key|access token|secret key|password|bearer token|credentials?)\b[^.\n]{0,24}\b(?:above|here|below|now)\b/i,
  },
];

/** A single line of context around a match, trimmed and length-bounded. */
function snippetAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export type LintViolation = { rule: string; description: string; snippet: string };

/** Every lint violation in `text`, in rule order then position order. */
export function lintViolations(text: string): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const rule of LINT_RULES) {
    const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    for (const match of text.matchAll(pattern)) {
      violations.push({
        rule: rule.id,
        description: rule.description,
        snippet: snippetAround(text, match.index ?? 0),
      });
    }
  }
  return violations;
}

/**
 * Refuse a body that still carries unsafe instructions. The fix is a recorded
 * edit in the workflow's edits.yaml that removes the text; the converter has
 * already applied those edits by the time this runs.
 */
export function assertCleanLint(skillKey: string, text: string): void {
  const violations = lintViolations(text);
  if (!violations.length) return;
  const detail = violations
    .map((v) => `${v.description} (${v.rule}): ${JSON.stringify(v.snippet)}`)
    .join("; ");
  throw new SkillConversionError(
    skillKey,
    null,
    `lint found content a recorded edit must remove: ${detail}`,
  );
}

// Tokens that mean a reference was not rewritten: a path under one of the
// upstream reference folders, or a bare path ending in a source extension.
const RESIDUE_PATTERN =
  /(?:references|resources|templates|workflows|shared|sources|methodology|scripts|evals|demo|assets)\/[^\s)`"']+|[^\s)`"'(]+\.(?:md|py|js|ts|json|sh|yaml|yml|html)\b/gi;

/**
 * Refuse any residual reference path after the rewrite step. Exactly the
 * shipped asset filenames in `assets/<name>` form are allowed, as the upstream
 * validator requires; URLs are excluded, because a footer or citation link is
 * not a reference residue. Runs on the source-derived text only.
 */
export function assertNoReferenceResidue(
  skillKey: string,
  text: string,
  shippedAssetPaths: readonly string[],
): void {
  const allowed = new Set(shippedAssetPaths);
  // Remove URLs first so http(s) links never read as reference residue.
  const scanned = text.replace(/https?:\/\/[^\s)`"']+/gi, " ");
  const offenders: string[] = [];
  for (const match of scanned.matchAll(RESIDUE_PATTERN)) {
    const token = match[0];
    if (allowed.has(token)) continue;
    offenders.push(token);
  }
  if (offenders.length) {
    throw new SkillConversionError(
      skillKey,
      null,
      `reference(s) were not rewritten to a shipped asset: ${[...new Set(offenders)]
        .map((token) => JSON.stringify(token))
        .join(", ")}`,
    );
  }
}
