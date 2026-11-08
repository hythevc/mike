import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingProfilePage from "./page";
import { legalDocumentForBrandKey } from "@/content/legal/registry";
import type { UserProfile } from "@/app/lib/mikeApi";

const {
    push,
    replace,
    reloadProfile,
    updateUserProfile,
    recordLegalAcceptances,
    profileState,
} = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    reloadProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    recordLegalAcceptances: vi.fn(),
    profileState: { current: null as unknown as UserProfile },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "user-1", email: "alex@example.com" },
        authLoading: false,
    }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: profileState.current,
        loading: false,
        reloadProfile,
    }),
}));

vi.mock("@/app/lib/mikeApi", () => ({ updateUserProfile, recordLegalAcceptances }));
vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>logo</div>,
}));

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        displayName: "Alex",
        organisation: "",
        onboardingVersion: null,
        legalAcceptanceRequired: [],
        ...overrides,
    } as unknown as UserProfile;
}

const TERMS_VERSION = legalDocumentForBrandKey("terms")!.version;
const PRIVACY_VERSION = legalDocumentForBrandKey("privacy")!.version;

describe("OnboardingProfilePage", () => {
    beforeEach(() => {
        push.mockReset();
        replace.mockReset();
        reloadProfile.mockReset().mockResolvedValue(undefined);
        updateUserProfile.mockReset().mockResolvedValue({});
        recordLegalAcceptances.mockReset().mockResolvedValue({});
        profileState.current = makeProfile();
    });

    it("allows an empty name and saves profile details before continuing", async () => {
        const user = userEvent.setup();
        render(<OnboardingProfilePage />);

        const name = screen.getByRole("textbox", { name: "Name" });
        await user.clear(name);
        await user.type(
            screen.getByRole("textbox", { name: /Organisation/ }),
            "Example LLP",
        );
        await user.click(screen.getByRole("button", { name: "Continue" }));

        await waitFor(() =>
            expect(updateUserProfile).toHaveBeenCalledWith({
                displayName: null,
                organisation: "Example LLP",
            }),
        );
        expect(recordLegalAcceptances).not.toHaveBeenCalled();
        expect(reloadProfile).toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith("/onboarding/practice");
    });

    it("keeps the first step labelled and shows no acceptance box when none is due", () => {
        render(<OnboardingProfilePage />);
        expect(screen.getByText("Step 1 of 4")).toBeVisible();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("requires accepting the current Terms and Privacy for a new account", async () => {
        const user = userEvent.setup();
        profileState.current = makeProfile({
            onboardingVersion: null,
            legalAcceptanceRequired: ["terms", "privacy"],
        });
        render(<OnboardingProfilePage />);

        // Continuing without checking the box is refused.
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(/accept/i),
        );
        expect(recordLegalAcceptances).not.toHaveBeenCalled();

        await user.click(screen.getByRole("checkbox"));
        await user.click(screen.getByRole("button", { name: "Continue" }));

        await waitFor(() =>
            expect(recordLegalAcceptances).toHaveBeenCalledWith([
                { document: "terms", version: TERMS_VERSION },
                { document: "privacy", version: PRIVACY_VERSION },
            ]),
        );
        expect(updateUserProfile).toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith("/onboarding/practice");
    });

    it("shows only the acceptance once the rest of onboarding is done", async () => {
        const user = userEvent.setup();
        profileState.current = makeProfile({
            displayName: "Alex",
            organisation: "Example LLP",
            onboardingVersion: 1,
            legalAcceptanceRequired: ["terms"],
        });
        render(<OnboardingProfilePage />);

        expect(
            screen.getByRole("heading", { name: "Review and accept" }),
        ).toBeVisible();
        expect(
            screen.queryByRole("textbox", { name: "Name" }),
        ).not.toBeInTheDocument();

        await user.click(screen.getByRole("checkbox"));
        await user.click(
            screen.getByRole("button", { name: "Accept and continue" }),
        );

        await waitFor(() =>
            expect(recordLegalAcceptances).toHaveBeenCalledWith([
                { document: "terms", version: TERMS_VERSION },
            ]),
        );
        expect(updateUserProfile).not.toHaveBeenCalled();
        expect(push).toHaveBeenCalledTimes(1);
    });
});
