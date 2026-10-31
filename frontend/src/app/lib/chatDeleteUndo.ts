// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How long a confirmed chat delete can be undone. This is the lifetime of
 * the notice that offers Undo, so it pauses while that notice is hovered or
 * focused; the server delete is sent once the notice closes without Undo.
 */
export const CHAT_DELETE_UNDO_MS = 8_000;

/**
 * How long signing out, or deleting the account, waits for the chat deletes
 * it sends first. A server that does not answer must not keep someone signed
 * in after they asked to leave.
 */
export const CHAT_DELETE_FLUSH_MS = 3_000;
