// SPDX-License-Identifier: AGPL-3.0-only
//
// GET /.well-known/security.txt (RFC 9116): where to report a vulnerability.
// Generated from the brand configuration on each request so the Expires
// field always lies ahead of the moment the file is read; a build that runs
// for months must not serve a date that has passed. /.well-known/ is a public
// route prefix, so no gate redirects it.

import { securityTxt } from "@/app/lib/securityTxt";

export const dynamic = "force-dynamic";

export function GET(): Response {
    return new Response(securityTxt(new Date()), {
        status: 200,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            // A day is well inside the half-year validity the file states.
            "Cache-Control": "public, max-age=86400",
        },
    });
}
