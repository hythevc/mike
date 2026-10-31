// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `?emptyStates=1` hides a page's rows so its empty state can be reviewed.
 * Production builds ignore it, so a shared link can never make someone's
 * work look missing.
 */
export function isEmptyStatesPreview(
    searchParams: Pick<URLSearchParams, "get"> | null | undefined,
): boolean {
    return (
        process.env.NODE_ENV !== "production" &&
        searchParams?.get("emptyStates") === "1"
    );
}
