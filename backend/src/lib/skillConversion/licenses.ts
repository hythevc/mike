// SPDX-License-Identifier: AGPL-3.0-only
//
// Licence handling for the converter: the allowlist, canonicalisation, the
// check that the declared licence matches the LICENSE file, the refusal of a
// manifest-only licence that has no author confirmation, and the footer
// clause each licence requires. The catalog parser enforces these again at
// sync time; refusing here names the skill before any output is written.

import { SkillConversionError } from "./sourceReader";

/** SPDX identifiers the converter accepts, verbatim as a licensor declares. */
export const CONVERTER_LICENSES = [
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "MIT",
  "CC-BY-4.0",
] as const;
export type ConverterLicense = (typeof CONVERTER_LICENSES)[number];

export type LicenseFamily = "AGPL" | "Apache" | "MIT" | "CC-BY";

const FAMILY_BY_LICENSE: Record<ConverterLicense, LicenseFamily> = {
  "AGPL-3.0": "AGPL",
  "AGPL-3.0-only": "AGPL",
  "AGPL-3.0-or-later": "AGPL",
  "Apache-2.0": "Apache",
  MIT: "MIT",
  "CC-BY-4.0": "CC-BY",
};

/** The SPDX id the licensor declared, refused if outside the allowlist. */
export function canonicalConverterLicense(
  declared: unknown,
  skillKey: string,
): ConverterLicense {
  const value = typeof declared === "string" ? declared.trim() : "";
  if (!value) {
    throw new SkillConversionError(
      skillKey,
      null,
      "declares no licence; the manifest must carry an SPDX licence",
    );
  }
  const match = CONVERTER_LICENSES.find(
    (license) => license.toLowerCase() === value.toLowerCase(),
  );
  if (!match) {
    throw new SkillConversionError(
      skillKey,
      null,
      `declares licence '${value}', which is outside the allowlist ` +
        `(${CONVERTER_LICENSES.join(", ")})`,
    );
  }
  return match;
}

export function licenseFamily(license: ConverterLicense): LicenseFamily {
  return FAMILY_BY_LICENSE[license];
}

/**
 * The licence family a LICENSE file grants, read from its text, or null when
 * the text matches none. Used to check that the declared licence matches the
 * file, so a mislabelled file is refused rather than trusted.
 */
export function detectLicenseFamily(text: string): LicenseFamily | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/GNU AFFERO GENERAL PUBLIC LICENSE\s*Version 3/i.test(normalized)) {
    return "AGPL";
  }
  if (/Apache License Version 2\.0/i.test(normalized)) return "Apache";
  if (
    /Creative Commons Attribution 4\.0/i.test(normalized) ||
    /creativecommons\.org\/licenses\/by\/4\.0/i.test(normalized)
  ) {
    return "CC-BY";
  }
  if (
    /Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(
      normalized,
    )
  ) {
    return "MIT";
  }
  return null;
}

/**
 * Check a LICENSE file against the declared licence. `null` licence text means
 * the skill ships no LICENSE file; that is allowed only when the manifest
 * supplies the licence another way, which the caller handles.
 */
export function assertLicenseFileMatches(
  skillKey: string,
  license: ConverterLicense,
  licenseFileName: string,
  licenseText: string,
): void {
  const detected = detectLicenseFamily(licenseText);
  if (detected === null) {
    throw new SkillConversionError(
      skillKey,
      licenseFileName,
      "does not look like a recognised licence; the catalog cannot confirm " +
        `it grants ${license}`,
    );
  }
  if (detected !== licenseFamily(license)) {
    throw new SkillConversionError(
      skillKey,
      licenseFileName,
      `grants a ${detected} licence but the manifest declares ${license}`,
    );
  }
}

export type LicenseEvidence = "file" | "manifest-only";
export type AuthorConfirmation =
  | "not-required"
  | "pending"
  | `confirmed ${string}`;

/**
 * Refuse a manifest-only licence that has no confirmation reference. A
 * file-backed licence needs none; a manifest-only one must carry
 * author-confirmation 'confirmed YYYY-MM-DD' and a stored confirmation file,
 * or it stays in staging and this refuses it, naming the skill.
 */
export function assertLicenseEvidenceConfirmed(
  skillKey: string,
  evidence: LicenseEvidence,
  confirmation: string | null,
  confirmationReference: string | null,
): void {
  if (evidence !== "manifest-only") return;
  const confirmedOn = confirmation?.match(/^confirmed (\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!confirmedOn) {
    throw new SkillConversionError(
      skillKey,
      null,
      "declares its licence only in a manifest; it needs author-confirmation " +
        "'confirmed YYYY-MM-DD' before it can be converted",
    );
  }
  if (!confirmationReference) {
    throw new SkillConversionError(
      skillKey,
      null,
      "declares a manifest-only licence but names no confirmation reference; " +
        "record the written confirmation under legal/confirmations/",
    );
  }
}

export type FooterClauseInput = {
  license: ConverterLicense;
  title: string;
  creator: string;
  copyrightHolder: string | null;
  copyrightYear: string | null;
  licenseLink: string;
};

const LICENSE_LINKS: Record<LicenseFamily, string> = {
  AGPL: "https://www.gnu.org/licenses/agpl-3.0.html",
  Apache: "https://www.apache.org/licenses/LICENSE-2.0",
  MIT: "https://opensource.org/license/mit",
  "CC-BY": "https://creativecommons.org/licenses/by/4.0/",
};

export function licenseLink(license: ConverterLicense): string {
  return LICENSE_LINKS[licenseFamily(license)];
}

/**
 * The one-sentence (MIT: short paragraph) licence clause for the attribution
 * footer. The MIT clause carries the full permission notice because imported
 * copies travel with only the workflow text, so the notice MIT requires in
 * copies must live in the footer.
 */
export function footerLicenseClause(input: FooterClauseInput): string {
  const { license, title, creator, copyrightHolder, copyrightYear } = input;
  switch (licenseFamily(license)) {
    case "AGPL":
      return (
        "This modified workflow is licensed under the GNU Affero General " +
        "Public License v3.0 only; its complete corresponding source is at " +
        "the link above; it comes with no warranty."
      );
    case "Apache":
      return (
        "Licensed under the Apache License 2.0, on an AS IS basis, without " +
        "warranties or conditions of any kind."
      );
    case "MIT": {
      const holder = copyrightHolder ?? creator;
      const year = copyrightYear ?? "";
      const copyrightLine = `Copyright (c) ${year ? `${year} ` : ""}${holder}`.trim();
      return (
        `${copyrightLine}. MIT License. Permission is hereby granted, free of ` +
        "charge, to any person obtaining a copy of this software and " +
        'associated documentation files (the "Software"), to deal in the ' +
        "Software without restriction, including without limitation the " +
        "rights to use, copy, modify, merge, publish, distribute, sublicense, " +
        "and/or sell copies of the Software, and to permit persons to whom " +
        "the Software is furnished to do so, subject to the following " +
        "conditions: The above copyright notice and this permission notice " +
        "shall be included in all copies or substantial portions of the " +
        'Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY ' +
        "KIND, express or implied."
      );
    }
    case "CC-BY":
      return (
        `${title} by ${creator} is licensed under CC BY 4.0 ` +
        "(https://creativecommons.org/licenses/by/4.0/); this is a modified " +
        "version, changes listed at the link above."
      );
  }
}
