/**
 * Authentication flow E2E tests:
 *   1. Login: invalid credentials show an error message
 *   2. Login: valid credentials redirect to /assistant
 *   3. Logout redirects to /login
 *   4. All protected routes redirect unauthenticated users to /login
 *   5. A signed-out deep link returns to its page after login, and after
 *      onboarding for a new account
 *
 * Tests 1, 2, 4 and 5 run in a fresh browser context (no stored session).
 * Test 3 logs in as the dedicated logout user that auth.setup.ts creates, so
 * the setup project must run first.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./fixtures";
import { completeOnboardingIfRequired } from "./onboarding";
import { ensureUser } from "./users";

/** Sign in on the login page the deep link was sent to. */
async function signIn(page: Page, email: string, password: string) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
}

/** Visit `deepLink` signed out and check it rides along to the login page. */
async function visitSignedOut(page: Page, deepLink: string) {
    await page.goto(deepLink);
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("next")).toBe(deepLink);
}

/* ─── Unauthenticated tests ───────────────────────────────────────────────── */

/* describe-scoped test.use so only these tests run without a stored session.
   File-level test.use would wipe the storageState for the authenticated
   logout test below. */
test.describe("unauthenticated", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    /* ── Test 1: invalid credentials show error ──────────────────────────── */

    test("login with invalid credentials shows error message", async ({
        page,
    }) => {
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);

        await page.fill("#email", "e2e@mike.local");
        await page.fill("#password", "definitely-wrong-password");
        await page.click('button[type="submit"]');

        /* No "networkidle" wait here: the expect() below already retries until
           React has set the `error` state and re-rendered, and it names the
           element we actually care about, so a hang fails pointing at the
           missing banner instead of at an inscrutable load state. */

        /* The login page opens a WarningPopup (role="alert", with a "Dismiss
           warning" button) when the `error` state is non-null after a failed
           signInWithPassword. The filter keeps Next's own route announcer,
           also an alert, out of the match.
           REGRESSION: fails if the popup is removed from the login page or
           if the catch block stops setting `error`. */
        await expect(
            page.getByRole("alert").filter({
                has: page.getByRole("button", { name: "Dismiss warning" }),
            }),
        ).toBeVisible({ timeout: 10_000 });
    });

    /* ── Test 2: valid credentials redirect to /assistant ─────────────────── */

    test("login with valid credentials redirects to /assistant", async ({
        page,
        e2eAccount,
        workerStorageState,
    }) => {
        /* Sign in as THIS worker's account (e2eAccount; e2e@mike.local on
           worker 0). Depending on `workerStorageState` makes Playwright run the
           worker fixture first, which creates the account and finishes its
           onboarding; this test's own page stays signed out because the
           describe overrides `storageState`. Without that dependency, a run
           on worker 1+ could log in as a user another worker has not
           onboarded yet and land on /onboarding/profile instead of
           /assistant. */
        void workerStorageState;
        const { email, password } = e2eAccount;

        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);

        await page.fill("#email", email);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');

        /* REGRESSION: fails if `router.push("/assistant")` is removed from
           the handleLogin success branch in frontend/src/app/login/page.tsx. */
        await expect(page).toHaveURL(/\/assistant/, { timeout: 15_000 });
    });

    /* ── Test 4: all protected routes redirect to /login ─────────────────── */

    test("all protected routes redirect unauthenticated users to /login", async ({
        page,
    }) => {
        /* Every route under the (pages) route group is protected by the layout
           auth guard:
               if (!authLoading && !isAuthenticated) {
                   router.replace(loginPathFor(page));
               }
           in frontend/src/app/(pages)/layout.tsx.
           REGRESSION: fails if that router.replace is removed from the
           layout, or if any of these routes is moved outside the (pages) group
           without adding its own auth guard. */
        const protectedRoutes = [
            "/projects",
            "/tabular-reviews",
            "/workflows",
            "/settings",
        ];

        for (const route of protectedRoutes) {
            await page.goto(route);
            /* Auth check is client-side (Supabase getSession) — allow time for
               the async check to resolve and for Next.js router.replace to
               fire. The page asked for rides along as ?next. */
            await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
            expect(new URL(page.url()).searchParams.get("next")).toBe(route);
        }
    });

    /* ── Test 5: deep links survive sign-in ─────────────────────────────── */

    test("a signed-out deep link returns to the same page after login", async ({
        page,
        e2eAccount,
        workerStorageState,
    }) => {
        /* As in test 2: the worker fixture creates and onboards this account
           first, so it signs straight in. The project need not exist: the
           page reports that in place and never redirects. */
        void workerStorageState;
        const deepLink = `/projects/${randomUUID()}`;

        await visitSignedOut(page, deepLink);
        await signIn(page, e2eAccount.email, e2eAccount.password);

        await expect(page).toHaveURL(new RegExp(`${deepLink}$`), {
            timeout: 15_000,
        });
    });

    test("a new account's deep link survives sign-in and onboarding", async ({
        page,
    }) => {
        test.setTimeout(90_000);
        const email = `e2e-deep-link-${randomUUID()}@example.com`;
        const password = "E2eDeepLink1!";
        await ensureUser(email, password);
        const deepLink = `/projects/${randomUUID()}`;

        await visitSignedOut(page, deepLink);
        await signIn(page, email, password);

        /* A new account is sent through onboarding first... */
        await page.waitForURL(/\/onboarding\/profile/, { timeout: 15_000 });
        await page.getByRole("button", { name: "Continue" }).click();
        await page.waitForURL(/\/onboarding\/practice/, { timeout: 15_000 });
        await page.getByRole("button", { name: "Skip" }).click();
        await page.waitForURL(/\/onboarding\/invitations/, { timeout: 15_000 });
        await page.getByRole("button", { name: "Continue" }).click();
        await page.waitForURL(/\/onboarding\/models/, { timeout: 15_000 });
        await page.getByRole("button", { name: "Finish" }).click();

        /* ...and the last step returns it to the page it asked for. */
        await expect(page).toHaveURL(new RegExp(`${deepLink}$`), {
            timeout: 15_000,
        });
    });
});

/* ─── Authenticated tests ─────────────────────────────────────────────────── */

/* ── Test 3: logout redirects to /login ─────────────────────────────────── */

/* The logout flow calls supabase.auth.signOut(), which defaults to GLOBAL
   scope and revokes the user's session server-side. If this ran against the
   shared `e2e@mike.local` user it would 401 every other parallel worker
   ("Invalid or expired token"). So this test starts from a clean session and
   logs in as a DEDICATED user (created in auth.setup.ts) whose session can be
   safely destroyed without affecting any other test. */
test.describe("logout (isolated user)", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    const logoutEmail =
        process.env.E2E_LOGOUT_EMAIL ?? "e2e-logout@mike.local";
    const logoutPassword =
        process.env.E2E_LOGOUT_PASSWORD ?? "E2eLogoutPass1!";

    test("logout from settings redirects to /login", async ({
        page,
    }) => {
        /* Log in fresh as the dedicated logout user. */
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);
        await page.fill("#email", logoutEmail);
        await page.fill("#password", logoutPassword);
        await page.click('button[type="submit"]');

        await completeOnboardingIfRequired(page);
        await page.waitForURL(/\/assistant/, { timeout: 15_000 });
        /* The sidebar's own expect() below is the real settle-wait — it
           retries on the element this test goes on to click. networkidle
           never fires against an app with SSE and polling in flight. */

    // The account menu has the same accessible name with a photo or monogram.
    const userMenuButton = page.getByRole("button", {
        name: "Account menu",
        exact: true,
    });
    await expect(userMenuButton).toBeVisible({ timeout: 10_000 });
    await userMenuButton.click();

    /* The dropdown that appears contains a "Settings" menu item which
       navigates to /settings via router.push("/settings"). */
    const accountSettingsItem = page.getByRole("menuitem", {
        name: "Settings",
    });
    await expect(accountSettingsItem).toBeVisible({ timeout: 5_000 });
    await accountSettingsItem.click();

    await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
    // Wait for Radix to finish closing the selected menu before reopening it.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(userMenuButton).toHaveAttribute("aria-expanded", "false");

    /* Sign out now lives in the account dropdown rather than the Settings
       page. Reopen the same sidebar menu after navigation and exercise the
       relocated action — waiting for the sidebar button to re-render after the
       route change, which is what the "networkidle" wait here was standing in
       for (badly: it can't tell a settled page from a stalled one). */
    await expect(userMenuButton).toBeVisible({ timeout: 10_000 });
    await userMenuButton.click();
    const signOutButton = page.getByRole("menuitem", {
        name: "Sign out",
        exact: true,
    });
    await expect(signOutButton).toBeVisible({ timeout: 5_000 });
    await signOutButton.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    /* Signing out on purpose leaves no ?next=/settings behind: whoever signs
       in next on this tab starts from the default page. */
    expect(new URL(page.url()).searchParams.get("next")).toBeNull();
    });
});
