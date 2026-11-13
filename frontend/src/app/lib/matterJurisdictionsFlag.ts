// SPDX-License-Identifier: AGPL-3.0-only
//
// The web app's switch for the matter jurisdiction profile: a project's
// jurisdictions, governing law and working language, and an organization's
// defaults for new projects. Off by default.
//
// It is a NEXT_PUBLIC_* value, so `next build` inlines it into the bundle:
// turning it on means rebuilding the web app (for the Docker image, passing
// the build argument). The server has its own switch,
// MATTER_JURISDICTIONS_ENABLED; a deployment turns both on together, and
// docs/deployment.md says how. It is read as the literal
// `process.env.NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED` expression on
// purpose: Next only replaces that exact form.

/**
 * Whether the web app shows the matter jurisdiction profile
 * (NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED is "true", trimmed, any case, as
 * the server reads its own switch). While it is off the project details, the
 * project header and the organization settings look as they did before the
 * profile existed, and nothing about it is requested from the server.
 */
export function matterJurisdictionsEnabled(): boolean {
    return (
        process.env.NEXT_PUBLIC_MATTER_JURISDICTIONS_ENABLED?.trim().toLowerCase() ===
        "true"
    );
}
