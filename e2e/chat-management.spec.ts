/** Real chat persistence and sidebar mutations, with only the provider replaced. */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./fixtures";
import { hasLlmKey, LLM_SKIP_REASON } from "./llm";
import { selectClaudeModel, expectSavedAnswer } from "./helpers";

/**
 * The undo window `ChatHistoryContext` keeps before sending a DELETE. It
 * pauses while the notice is hovered or focused; these tests never do that.
 */
const UNDO_WINDOW_MS = 8_000;

/** The sidebar row whose title button is `title`. */
function sidebarRow(page: Page, title: string) {
    const titleButton = page.getByRole("button", { name: title, exact: true });
    return {
        titleButton,
        row: page
            .locator("div.group.relative.h-8.rounded-md")
            .filter({ has: titleButton }),
    };
}

/** Choose Delete in the row's menu and confirm it in the dialog. */
async function confirmDeleteFromSidebar(page: Page, title: string) {
    const { row } = sidebarRow(page, title);
    await row.hover();
    await row.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete chat?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
}

test("chat lifecycle: answer survives reload, rename and delete persist", async ({ page }) => {
    test.skip(!hasLlmKey, LLM_SKIP_REASON);
    test.setTimeout(120_000);
    const reply = `Chat round trip ${randomUUID()}`;
    const title = `Renamed ${randomUUID()}`;

    await page.goto("/assistant");
    await selectClaudeModel(page);
    await page.getByPlaceholder("How can I help?").fill(`Reply with exactly: ${reply}`);
    await page.getByPlaceholder("How can I help?").press("Enter");
    await expect(page).toHaveURL(/\/assistant\/chat\/[^/]+$/);
    const chatUrl = page.url();
    const chatId = new URL(chatUrl).pathname.split("/").at(-1);
    await expectSavedAnswer(page, reply);

    const openSidebar = page.getByTitle("Open sidebar").first();
    if (await openSidebar.isVisible()) await openSidebar.click();
    // The just-created chat is first. Once renamed, use its unique title.
    const row = page.locator("div.group.relative.h-8.rounded-md").first();
    await row.hover();
    await row.locator("button").last().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.getByLabel("Chat title").fill(title);
    const renamed = page.waitForResponse(r =>
        new URL(r.url()).pathname === `/api/chat/${chatId}` && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await renamed).ok()).toBe(true);
    await page.reload();
    const { titleButton } = sidebarRow(page, title);
    await expect(titleButton).toBeVisible();

    // Confirmed deletes wait out the undo window before the DELETE is sent.
    const deleted = page.waitForResponse(
        r =>
            new URL(r.url()).pathname === `/api/chat/${chatId}` && r.request().method() === "DELETE",
        { timeout: UNDO_WINDOW_MS + 15_000 },
    );
    await confirmDeleteFromSidebar(page, title);
    expect((await deleted).ok()).toBe(true);

    // A fresh load must reject the deleted chat, not merely hide an optimistic
    // row, and the page says so where the chat was instead of swapping in a
    // blank chat.
    const missing = page.waitForResponse(r =>
        new URL(r.url()).pathname === `/api/chat/${chatId}` && r.request().method() === "GET",
    );
    await page.goto(chatUrl);
    expect((await missing).status()).toBe(404);
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this chat" })).toBeVisible();
    await expect(page).toHaveURL(chatUrl);
    await expect(titleButton).toBeHidden();
    await page.getByRole("button", { name: "Start a new chat", exact: true }).click();
    await expect(page).toHaveURL(/\/assistant$/);
});

test("chat delete asks first, and Undo within the window keeps the chat", async ({ page }) => {
    test.setTimeout(90_000);
    const title = `Undo check ${randomUUID()}`;

    // An empty chat with a unique title, made through the API so this flow
    // needs no model provider.
    await page.goto("/assistant");
    const chatId = await page.evaluate(async (chatTitle) => {
        const headers = { "Content-Type": "application/json", Accept: "application/json" };
        const created = await fetch("/api/chat/create", {
            method: "POST",
            headers,
            body: "{}",
            credentials: "include",
        });
        if (!created.ok) throw new Error(`chat create failed: ${created.status}`);
        const { id } = (await created.json()) as { id: string };
        const renamed = await fetch(`/api/chat/${id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ title: chatTitle }),
            credentials: "include",
        });
        if (!renamed.ok) throw new Error(`chat rename failed: ${renamed.status}`);
        return id;
    }, title);
    await page.reload();
    const openSidebar = page.getByTitle("Open sidebar").first();
    if (await openSidebar.isVisible()) await openSidebar.click();
    const { row, titleButton } = sidebarRow(page, title);
    await expect(titleButton).toBeVisible();

    const deletes: string[] = [];
    page.on("request", (request) => {
        if (
            request.method() === "DELETE" &&
            new URL(request.url()).pathname === `/api/chat/${chatId}`
        ) {
            deletes.push(request.url());
        }
    });

    // Cancelling the confirmation deletes nothing.
    await row.hover();
    await row.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete chat?" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(titleButton).toBeVisible();

    // Confirmed, the row goes at once; Undo inside the window brings it back
    // and no DELETE is ever sent.
    await confirmDeleteFromSidebar(page, title);
    await expect(titleButton).toBeHidden();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(titleButton).toBeVisible();
    // Waiting out the window is the assertion: nothing may be sent in it.
    await page.waitForTimeout(UNDO_WINDOW_MS + 1_000);
    expect(deletes).toEqual([]);
    await page.reload();
    await expect(titleButton).toBeVisible();

    // Without Undo, the DELETE goes once the window has passed.
    const deleted = page.waitForResponse(
        r =>
            new URL(r.url()).pathname === `/api/chat/${chatId}` && r.request().method() === "DELETE",
        { timeout: UNDO_WINDOW_MS + 15_000 },
    );
    await confirmDeleteFromSidebar(page, title);
    expect((await deleted).ok()).toBe(true);
    await page.reload();
    await expect(titleButton).toBeHidden();
});
