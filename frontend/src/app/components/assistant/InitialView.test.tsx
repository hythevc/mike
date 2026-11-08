// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { brand } from "@/shared/brand.generated";

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { email: "alex@example.com" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: { displayName: "Alex", quickActionsVisible: true },
    }),
}));
vi.mock("./ChatInput", () => ({
    ChatInput: () => <div data-testid="chat-input" />,
}));
// The first-run checklist mounts inside the start screen. Its hook reads the
// router and the API, which this unit test does not stand up; the checklist
// has its own tests (FirstRunChecklist.test.tsx) and is stubbed here the same
// way they stub it, so its copy still renders into the brand assertions below.
vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspaceParam: () => undefined,
}));
vi.mock("@/app/hooks/useSampleMatter", () => ({
    useSampleMatter: () => ({ pending: false, openSampleMatter: () => {} }),
}));

import { InitialView } from "./InitialView";

describe("InitialView", () => {
    it("recomposes the start screen around the brand, not the legacy name", () => {
        render(
            <InitialView
                onSubmit={() => {}}
                quickActions={[]}
                onEditQuickActions={() => {}}
            />,
        );
        expect(screen.getByText(brand.productName)).toBeInTheDocument();
        expect(document.body.textContent ?? "").not.toContain(brand.upstreamAttribution.projectName);
        // The legal-information line stays.
        expect(
            screen.getByText(/Answers are not legal advice/),
        ).toBeInTheDocument();
        // "Configure quick actions" is reachable without a hover.
        expect(
            screen.getByRole("button", { name: "Configure quick actions" }),
        ).toBeVisible();
    });
});