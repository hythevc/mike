// SPDX-License-Identifier: AGPL-3.0-only
import { brand } from "./brand.generated";

/**
 * Lowercase, hyphenated product name used as the prefix of the files users
 * download (data exports, project manifests). Derived from the single brand
 * config so the names follow a rebrand without being hard-coded, and kept in
 * the shared kernel so it can be imported without pulling in a feature module.
 */
export const brandFileSlug =
    brand.productName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "export";
