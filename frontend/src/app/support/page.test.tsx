import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";
import SupportPage from "./page";

const { router, auth } = vi.hoisted(() => ({
    router: { push: vi.fn() },
    auth: {
        user: { id: "user-1", email: "alex@example.com" } as {
            id: string;
            email: string;
        } | null,
        isAuthenticated: true,
        authLoading: false,
    },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/contexts/AuthContext", () => ({ useAuth: () => auth }));

describe("SupportPage", () => {
    beforeEach(() => {
        router.push.mockReset();
        auth.user = { id: "user-1", email: "alex@example.com" };
        auth.isAuthenticated = true;
        auth.authLoading = false;
    });

    it("points to the brand support mailbox and documentation", () => {
        render(<SupportPage />);

        expect(
            screen.getByRole("heading", { name: "Support" }),
        ).toBeInTheDocument();

        const email = screen.getByRole("link", { name: /Email support/ });
        expect(email).toHaveAttribute(
            "href",
            expect.stringContaining(`mailto:${brand.supportEmail}`),
        );

        const docs = screen.getByRole("link", { name: /Documentation/ });
        expect(docs).toHaveAttribute("href", brand.docsUrl);
    });

    it("sends a signed-out visitor home", () => {
        auth.user = null;
        auth.isAuthenticated = false;
        render(<SupportPage />);
        expect(router.push).toHaveBeenCalledWith("/");
    });
});
