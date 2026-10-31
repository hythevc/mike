<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Brand configuration

`brand.json` holds every product name, address, legal document and mark the
applications show. `brand.schema.json` defines and documents each field.
Renaming the product, or rebranding a self-hosted installation, is an edit to
`brand.json` followed by one command from the repository root:

```bash
node scripts/brand/generate.mjs
```

The command validates `brand.json` against the schema, checks that
`palette.onPrimary` reaches a 4.5:1 contrast ratio on `palette.primary`, and
writes the same TypeScript module into each application:

| Generated module | Used by | Import as |
| --- | --- | --- |
| `frontend/src/shared/brand.generated.ts` | web app | `@/shared/brand.generated` |
| the same file | Word add-in | `@mike/brand` (alias in `word-addin/tsconfig.json` and `word-addin/webpack.config.js`) |
| `backend/src/lib/brand.generated.ts` | API, workers and jobs | a relative import of `lib/brand.generated` |

Commit `brand.json` and both generated modules together.
`node --test scripts/brand/generate.test.mjs` fails while a generated module
differs from `brand.json`, and `node scripts/brand/generate.mjs --check`
reports which one is out of date.

No application reads `packages/` at runtime, so the Docker images, the
desktop local stack (which stages only `backend/dist`) and the add-in build
need nothing from this directory. The architecture tests in `backend/src` and
`frontend/src` fail if production code refers to `packages/brand`.

## Fields

| Field | Notes |
| --- | --- |
| `productName` | At most 40 characters. |
| `assistantName` | Optional. Defaults to `<productName> Assistant`. It names a product feature, never a person. |
| `legalEntityName` | The operating company's legal name. |
| `appUrl`, `marketingUrl`, `docsUrl`, `changelogUrl`, `sourceRepositoryUrl` | Absolute `https://` addresses. `sourceRepositoryUrl` must hold the complete corresponding source of the running service. |
| `supportEmail`, `securityEmail` | Mailboxes. |
| `upstreamAttribution` | The project this software derives from: name, author, address, SPDX licence and a one-sentence notice. |
| `legalDocuments` | `terms`, `privacy`, `dpa`, `subprocessors`, `aup`, `aiTransparency`, `accessibility`, `cookies` and `security`, each with a `url` (an `https://` address or a path in the web app), a `version`, and a `status` of `draft` or `in-effect`. |
| `assets` | `glyph`, `wordmark`, `favicon` and `ogImage`: root-relative paths of image files the web app serves. |
| `palette` | `primary` and `onPrimary` as `#RRGGBB`. |
| `displayFace` | One of the faces bundled with the web app: `inter` or `eb-garamond`. |
| `docxAuthorLabel` | Optional. The author name on tracked changes and document properties written into Word files. Defaults to `assistantName`. |

Values in square brackets and `example.com` addresses are placeholders to be
replaced before the service is offered to anyone.

Some identifiers are deliberately not part of the brand and keep their
historical names: the session cookie, the add-in sign-in handoff and the
project export manifest format, browser storage keys, database table names,
and the `@mike/*` package and alias names. Renaming them would sign every user
out and break verification of exports that were already signed.
