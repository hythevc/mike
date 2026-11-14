import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemePreference } from "@/app/lib/theme";
import AppearancePage from "./page";

const { updateTheme, profile } = vi.hoisted(() => ({
    updateTheme: vi.fn(),
    profile: { theme: "system" as ThemePreference },
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile, updateTheme }),
}));

describe("AppearancePage", () => {
    beforeEach(() => {
        updateTheme.mockReset();
        updateTheme.mockResolvedValue(undefined);
        profile.theme = "system";
    });

    it("offers System, Light and Dark as a radio group with the current choice checked", async () => {
        const user = userEvent.setup();
        render(<AppearancePage />);

        expect(
            screen.getByRole("heading", { name: "Appearance" }),
        ).toBeVisible();
        expect(
            screen.getByRole("radiogroup", { name: "Theme" }),
        ).toBeInTheDocument();

        const system = screen.getByRole("radio", { name: /System/ });
        const light = screen.getByRole("radio", { name: /Light/ });
        const dark = screen.getByRole("radio", { name: /Dark/ });
        expect(system).toHaveAttribute("aria-checked", "true");
        expect(light).toHaveAttribute("aria-checked", "false");
        expect(dark).toHaveAttribute("aria-checked", "false");

        await user.click(dark);
        expect(updateTheme).toHaveBeenCalledWith("dark");
    });

    it("reports a failed change without leaking the raw error", async () => {
        const user = userEvent.setup();
        updateTheme.mockRejectedValue(new Error("pg: connection refused"));
        render(<AppearancePage />);

        await user.click(screen.getByRole("radio", { name: /Light/ }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Could not update the appearance setting.",
            ),
        );
        expect(
            screen.queryByText(/connection refused/i),
        ).not.toBeInTheDocument();
    });
});
