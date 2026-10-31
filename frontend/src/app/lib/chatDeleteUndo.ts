// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How long a confirmed chat delete can be undone. The server delete is sent
 * only after this window passes without Undo.
 */
export const CHAT_DELETE_UNDO_MS = 8_000;
