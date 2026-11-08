// SPDX-License-Identifier: AGPL-3.0-only
//
// The body of /.well-known/security.txt (RFC 9116), generated from the brand
// configuration so the reporting mailbox is never written twice. `Contact`
// and `Expires` are the two required fields; `Expires` must lie in the
// future and should be less than a year away, so it is computed from the
// time of the request rather than baked into a build that may run for months.

import { brand } from "@/shared/brand.generated";

/** How far ahead of the request `Expires` is set. */
export const SECURITY_TXT_VALIDITY_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

function appPath(path: string): string {
    return new URL(path, brand.appUrl).toString();
}

/** The `Expires` value for a file served at `now`: RFC 3339, whole seconds. */
export function securityTxtExpires(now: Date): string {
    const expires = new Date(now.getTime() + SECURITY_TXT_VALIDITY_DAYS * DAY_MS);
    return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The complete file for a request at `now`, with a trailing newline. */
export function securityTxt(now: Date = new Date()): string {
    return [
        `Contact: mailto:${brand.securityEmail}`,
        `Expires: ${securityTxtExpires(now)}`,
        "Preferred-Languages: en",
        `Canonical: ${appPath("/.well-known/security.txt")}`,
        `Policy: ${appPath(brand.legalDocuments.security.url)}`,
        "",
    ].join("\n");
}
