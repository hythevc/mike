import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { AUTH_SESSION_INVALIDATED_EVENT } from "@/app/lib/authEvents";
import {
    ToastViewportUI,
    clearToasts,
    showToast,
} from "@/shared/ui/ToastUI";

const {
    clearLegacyBrowserAuthStorage,
    getAuthSession,
    logout,
    updateAuthEmail,
    updateAuthPassword,
} = vi.hoisted(() => ({
    clearLegacyBrowserAuthStorage: vi.fn(),
    getAuthSession: vi.fn(),
    logout: vi.fn(),
    updateAuthEmail: vi.fn(),
    updateAuthPassword: vi.fn(),
}));

vi.mock("@/app/lib/authApi", () => ({
    clearLegacyBrowserAuthStorage,
    getAuthSession,
    logout,
    updateAuthEmail,
    updateAuthPassword,
}));

const user = {
    id: "user-1",
    email: "lawyer@example.test",
    pendingEmail: null,
    createdWithGoogle: false,
};

function Consumer() {
    const {
        user: currentUser,
        authLoading,
        authError,
        signedOutOnPurpose,
        signOut,
    } = useAuth();
    return (
        <>
            <span data-testid="user">{currentUser?.email ?? "signed-out"}</span>
            <span data-testid="loading">{String(authLoading)}</span>
            <span data-testid="error">{authError ?? ""}</span>
            <span data-testid="on-purpose">{String(signedOutOnPurpose)}</span>
            <button
                type="button"
                onClick={() => void signOut().catch(() => {})}
            >
                Sign out
            </button>
        </>
    );
}

describe("AuthProvider", () => {
    afterEach(() => clearToasts());
    beforeEach(() => {
        clearToasts();
        getAuthSession.mockReset();
        logout.mockReset();
        clearLegacyBrowserAuthStorage.mockReset();
        updateAuthEmail.mockReset();
        updateAuthPassword.mockReset();
        window.localStorage.clear();
    });

    it("surfaces an initial session failure without leaving loading stuck", async () => {
        getAuthSession.mockRejectedValue(new Error("gateway unavailable"));

        render(
            <AuthProvider>
                <Consumer />
            </AuthProvider>,
        );

        await waitFor(() =>
            expect(screen.getByTestId("loading")).toHaveTextContent("false"),
        );
        expect(screen.getByTestId("user")).toHaveTextContent("signed-out");
        expect(screen.getByTestId("error")).toHaveTextContent(
            "We could not check your session",
        );
    });

    it.each([
        ["/login", 0],
        ["/signup", 0],
        ["/reset-password", 0],
        ["/assistant", 1],
    ])(
        "on %s, a failed session check raises %i session toasts",
        async (path, toasts) => {
            // Live check (2026-10-04, backend down): /login showed its inline
            // "We could not check your session" AND a toast saying the same,
            // and the two disagreed once the user tried to sign in. Auth
            // screens own their error; the toast is for every other page.
            window.history.pushState({}, "", path);
            clearToasts();
            getAuthSession.mockRejectedValue(new Error("gateway unavailable"));

            render(
                <AuthProvider>
                    <Consumer />
                    <ToastViewportUI />
                </AuthProvider>,
            );

            await waitFor(() =>
                expect(screen.getByTestId("error")).toHaveTextContent(
                    "We could not check your session",
                ),
            );
            expect(
                screen.queryAllByText(/Couldn't check your session/),
            ).toHaveLength(toasts);
            clearToasts();
            window.history.pushState({}, "", "/");
        },
    );

    it("clears stale in-memory auth when an API request returns 401", async () => {
        getAuthSession.mockResolvedValue(user);
        render(
            <AuthProvider>
                <Consumer />
            </AuthProvider>,
        );
        await screen.findByText(user.email);

        fireEvent(window, new Event(AUTH_SESSION_INVALIDATED_EVENT));

        expect(screen.getByTestId("user")).toHaveTextContent("signed-out");
        expect(screen.getByTestId("error")).toHaveTextContent(
            "Your session expired",
        );
    });

    it("keeps the user signed in and exposes an error when logout fails", async () => {
        getAuthSession.mockResolvedValue(user);
        logout.mockRejectedValue(new Error("network failure"));
        render(
            <AuthProvider>
                <Consumer />
            </AuthProvider>,
        );
        await screen.findByText(user.email);

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await waitFor(() =>
            expect(screen.getByTestId("error")).toHaveTextContent(
                "Unable to sign out",
            ),
        );
        expect(screen.getByTestId("user")).toHaveTextContent(user.email);
    });

    it("applies a sign-out broadcast from another tab", async () => {
        getAuthSession.mockResolvedValue(user);
        render(
            <AuthProvider>
                <Consumer />
            </AuthProvider>,
        );
        await screen.findByText(user.email);

        const event = new Event("storage") as StorageEvent;
        Object.defineProperties(event, {
            key: { value: "mike-auth-state-change" },
            newValue: {
                value: JSON.stringify({
                    state: "signed-out",
                    nonce: "another-tab",
                }),
            },
        });
        window.dispatchEvent(event);

        await waitFor(() =>
            expect(screen.getByTestId("user")).toHaveTextContent("signed-out"),
        );
    });

    it("clears leftover toasts when the user signs out", async () => {
        getAuthSession.mockResolvedValue(user);
        logout.mockResolvedValue(undefined);

        render(
            <AuthProvider>
                <Consumer />
                <ToastViewportUI />
            </AuthProvider>,
        );
        await waitFor(() =>
            expect(screen.getByTestId("user")).toHaveTextContent(user.email),
        );

        // A failure raised while signed in, still on screen: its "Retry"
        // would now run as nobody, over the login form.
        showToast({
            tone: "error",
            title: "Couldn't save the document",
            message: "Try again.",
            actions: [{ label: "Retry", onClick: () => {} }],
        });
        expect(await screen.findByRole("alert")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await waitFor(() =>
            expect(screen.getByTestId("user")).toHaveTextContent("signed-out"),
        );
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        clearToasts();
    });
    it.each(["invalidation", "null refresh", "account switch"])(
        "clears previous-session actions on %s",
        async (transition) => {
            getAuthSession.mockResolvedValue(user);
            render(<AuthProvider><Consumer /><ToastViewportUI /></AuthProvider>);
            await screen.findByText(user.email);
            showToast({ tone: "error", title: "Save failed", message: "Try again.",
                actions: [{ label: "Retry old write", onClick: vi.fn() }] });
            expect(await screen.findByRole("button", { name: "Retry old write" })).toBeVisible();
            if (transition === "invalidation") {
                fireEvent(window, new Event(AUTH_SESSION_INVALIDATED_EVENT));
            } else {
                getAuthSession.mockResolvedValue(transition === "null refresh" ? null : {
                    ...user, id: "user-2", email: "second@example.test",
                });
                fireEvent(window, new Event("focus"));
            }
            await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent(
                transition === "account switch" ? "second@example.test" : "signed-out",
            ));
            expect(screen.queryByRole("button", { name: "Retry old write" })).not.toBeInTheDocument();
        },
    );

    // The app shell drops ?next after a sign-out the person chose, so the
    // next person to sign in on a shared machine does not land on the page
    // left behind. An expired session keeps it.
    describe("signedOutOnPurpose", () => {
        function storageMessage(message: Record<string, unknown>) {
            const event = new Event("storage") as StorageEvent;
            Object.defineProperties(event, {
                key: { value: "mike-auth-state-change" },
                newValue: { value: JSON.stringify(message) },
            });
            return event;
        }

        it("marks a sign-out chosen here and tells other tabs it was chosen", async () => {
            getAuthSession.mockResolvedValue(user);
            logout.mockResolvedValue(undefined);
            render(<AuthProvider><Consumer /></AuthProvider>);
            await screen.findByText(user.email);
            expect(screen.getByTestId("on-purpose")).toHaveTextContent("false");

            fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

            await waitFor(() =>
                expect(screen.getByTestId("on-purpose")).toHaveTextContent("true"),
            );
            expect(
                JSON.parse(window.localStorage.getItem("mike-auth-state-change")!),
            ).toMatchObject({ state: "signed-out", onPurpose: true });
        });

        it("leaves a session that expired unmarked", async () => {
            getAuthSession.mockResolvedValue(user);
            render(<AuthProvider><Consumer /></AuthProvider>);
            await screen.findByText(user.email);

            fireEvent(window, new Event(AUTH_SESSION_INVALIDATED_EVENT));

            expect(screen.getByTestId("user")).toHaveTextContent("signed-out");
            expect(screen.getByTestId("on-purpose")).toHaveTextContent("false");
            expect(
                JSON.parse(window.localStorage.getItem("mike-auth-state-change")!),
            ).not.toHaveProperty("onPurpose");
        });

        it.each([
            [true, "true"],
            [undefined, "false"],
        ])(
            "follows another tab's sign-out (chosen: %s)",
            async (onPurpose, marked) => {
                getAuthSession.mockResolvedValue(user);
                render(<AuthProvider><Consumer /></AuthProvider>);
                await screen.findByText(user.email);

                window.dispatchEvent(
                    storageMessage({ state: "signed-out", nonce: "other-tab", onPurpose }),
                );

                await waitFor(() =>
                    expect(screen.getByTestId("user")).toHaveTextContent("signed-out"),
                );
                expect(screen.getByTestId("on-purpose")).toHaveTextContent(marked);
            },
        );

        it("clears the mark when someone signs in again", async () => {
            getAuthSession.mockResolvedValue(user);
            logout.mockResolvedValue(undefined);
            render(<AuthProvider><Consumer /></AuthProvider>);
            await screen.findByText(user.email);
            fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
            await waitFor(() =>
                expect(screen.getByTestId("on-purpose")).toHaveTextContent("true"),
            );

            window.dispatchEvent(
                storageMessage({ state: "signed-in", nonce: "other-tab" }),
            );

            await screen.findByText(user.email);
            expect(screen.getByTestId("on-purpose")).toHaveTextContent("false");
        });
    });
});
