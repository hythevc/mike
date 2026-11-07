// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowCatalogAttribution } from "../shared/types";
import { listWorkflowAttributions } from "@/app/lib/mikeApi";
import { WorkflowAttributionsPage } from "./WorkflowAttributionsPage";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listWorkflowAttributions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function entry(
  overrides?: Partial<WorkflowCatalogAttribution>,
): WorkflowCatalogAttribution {
  return {
    workflow_key: "opposing-counsel-review",
    title: "Opposing Counsel Review",
    type: "assistant",
    distribution: "addon",
    pack_key: "disputes",
    pack_title: "Disputes",
    version: "1.2.0",
    contributors: [
      {
        name: "Larissa Meredith-Flister",
        organisation: null,
        role: null,
        linkedin: null,
      },
    ],
    license: "Apache-2.0",
    license_evidence: "file",
    attribution: "Based on Opposing Counsel Review.",
    provenance: {
      catalog_repository: "Open-Legal-Products/mike-workflows",
      catalog_path: "assistant-workflows/opposing-counsel-review",
      license_file: null,
      source_repository: null,
      source_path: null,
      source_commit: null,
      source_name: null,
      source_version: null,
      review_by: null,
    },
    source_commit: "ce62e6a2",
    ...overrides,
  };
}

describe("WorkflowAttributionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it("lists each catalog workflow with its author, licence and source", async () => {
    vi.mocked(listWorkflowAttributions).mockResolvedValue([entry()]);
    render(<WorkflowAttributionsPage />);

    expect(
      await screen.findByRole("heading", { name: "Opposing Counsel Review" }),
    ).toBeVisible();
    expect(screen.getByText("Larissa Meredith-Flister")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Apache-2\.0 licence text/ }),
    ).toHaveAttribute("href", "https://spdx.org/licenses/Apache-2.0.html");
    expect(
      screen.getByRole("link", { name: "View source at this revision" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/Open-Legal-Products/mike-workflows/tree/ce62e6a2/assistant-workflows/opposing-counsel-review",
    );
    expect(screen.getByText("1.2.0")).toBeVisible();
  });

  it("shows an empty state when the catalog has no workflows", async () => {
    vi.mocked(listWorkflowAttributions).mockResolvedValue([]);
    render(<WorkflowAttributionsPage />);
    expect(
      await screen.findByText("No workflows are in the active catalog yet."),
    ).toBeVisible();
  });

  it("shows an error state with Try again that refetches", async () => {
    const user = userEvent.setup();
    vi.mocked(listWorkflowAttributions)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([entry()]);
    render(<WorkflowAttributionsPage />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(listWorkflowAttributions).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByRole("heading", { name: "Opposing Counsel Review" }),
    ).toBeVisible();
  });
});
