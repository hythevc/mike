<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Legal workflow library pipeline

The legal workflow library is a catalog of workflows adapted from third-party
legal skills. Each catalog entry is produced mechanically from one upstream
skill folder plus a per-workflow conversion manifest, and must pass this
application's own catalog parser before it can be released. This document
describes that pipeline: the converter, the validator, and how a release is
pinned. It does not record which skills were chosen or why.

The catalog is a separate public repository, not a folder of this repository.
The application pins a catalog commit and downloads that commit's archive at
sync time (`backend/src/lib/workflowCatalogSource.ts`). The tools described
here live in this repository and run against a checkout of the catalog and a
checkout of the source skills.

## Commands

Both commands are built with the backend and run as compiled jobs, like
`sync:workflows`:

```bash
npm run build --prefix backend
npm run convert:legal-skills --prefix backend -- \
  --source <source-skills-checkout> \
  --conversion <source-skills-checkout>/conversion \
  --out <catalog-checkout>
npm run validate:catalog --prefix backend -- --catalog <catalog-checkout>
```

- `convert:legal-skills` turns each workflow named by the conversion manifests
  into a catalog entry under `--out`. With `--check` it re-runs the conversion
  and exits non-zero if the result differs from what is already on disk,
  writing nothing.
- `validate:catalog` zips the catalog checkout, applies the size budget, and
  runs it through the real catalog parser.

The converter adds no runtime dependencies; it uses only `yaml` and `jszip`,
which the backend already has.

## Conversion

The converter is deterministic: the same inputs always produce the same bytes.
Word assets and their ZIP containers are built with a fixed timestamp and
stable element order, and there are no random identifiers, so continuous
integration can re-run the converter and fail on any difference.

Every source byte is treated as untrusted data. The source reader refuses, and
names the skill and the file:

- symbolic links and hard links;
- absolute paths and paths that escape the skill folder with `..`;
- files over 5 MB;
- text that is not valid UTF-8.

Frontmatter and manifest YAML are parsed with a safe loader: the core schema,
no custom tags, and a 64 KB cap.

For each workflow the converter:

1. Ships only `SKILL.md` and the references the manifest maps. Script, tooling
   and build folders and files are never copied; the output contains no
   executable content. A manifest that maps a script, source file, executable,
   build file, or any file carrying a shebang or an executable bit as an asset
   is refused, so this holds even when a reference is mapped by hand — code
   written as data is dropped or replaced by hand-written Markdown, never
   auto-converted.
2. Builds the frontmatter in a fixed order, with quoted metadata, a semantic
   version, one practice from a closed list, jurisdiction codes with their
   labels, and a 60–180 character description that ends `Draft for lawyer
   review.`
3. Replaces the first heading with the display name, inserts the copilot
   ground rules, applies the manifest's recorded edits, removes promotion and
   cross-skill sections, and rewrites references.
4. Turns a mapped reference into either a Word asset referenced as
   `assets/<file>.docx` under a `## Reference documents` list, or an inline
   `## Appendix`. Every mapped reference — inline or converted to Word — runs
   through the same pipeline as the body: its own recorded edits, the
   script-fence strip, and the lint, residue and jurisdiction scans, so a Word
   asset cannot carry install, fetch, credential or MCP content that the inline
   path refuses. The editable Markdown of every converted asset is kept under
   the workflow's `source/` directory. On a filename collision the next parent
   directory is kept so no asset is overwritten. After the rewrite, any residual
   reference path fails the build.
5. Appends the output requirements and the attribution footer.

### Guardrails

Every workflow carries the copilot posture: it produces legal information, not
legal advice; a qualified lawyer must review everything it produces; and it
takes no outbound action without the lawyer's approval. The
legal-information-not-legal-advice line travels inside the workflow text so it
survives import and export.

### Lint

The lint gate runs on the converted body before the fixed guardrail texts are
added, so a rule can only be cleared by a recorded edit in the workflow's
`edits.yaml`. It refuses:

- instructions to run code or install packages;
- writes to agent instruction files such as `CLAUDE.md` or `AGENTS.md`;
- silent or automatic web search;
- instructions to hide work from the user;
- vendor or model-context-protocol steering;
- fixed external fetch URLs;
- credential collection.

### Licences and notices

- Licences outside the allowlist (`AGPL-3.0`, `Apache-2.0`, `MIT`,
  `CC-BY-4.0`) are refused. A licence declared only in a manifest is refused
  until an author confirmation reference is recorded.
- The declared licence must match the licence the `LICENSE` file grants.
- `LICENSE`, `NOTICE` and `COPYING` files are kept verbatim at the workflow
  root. For Apache sources with a `NOTICE`, the converter emits a `NOTICE` with
  the upstream text verbatim followed by a separate block carrying our dated
  modification statement.
- A dated modification notice appears in the attribution footer and in each
  Word asset's provenance paragraph.
- Each workflow ships a `CHANGES.md` and a `PROVENANCE.yaml` recording the
  source, the file hashes, the licence evidence, the dropped files, the dropped
  source-frontmatter keys, the rewritten script spans, the applied edits and any
  reviewer waiver of the jurisdiction scan.

## Validation

`validate:catalog` runs over a catalog checkout:

- the size budget: it warns at 7 MB zipped and fails at 8 MB, below the ceiling
  the application's sync enforces on the downloaded archive;
- the application's own `prepareWorkflowCatalog` and
  `validateWorkflowCatalogDocument`, which apply the licence, asset and
  never-ship gates and validate the parsed catalog document;
- the five required default workflows must be present.

## Release pinning

The catalog commit a release syncs is pinned in
`backend/src/lib/workflowCatalogPin.ts`. The continuous-integration workflows
`.github/workflows/e2e.yml` and `.github/workflows/desktop.yml` sync the
catalog using that pin rather than a hard-coded commit or a branch name, so the
fixture catalog they build against is reproducible. Moving to a newer catalog
release is a change to the pin.
