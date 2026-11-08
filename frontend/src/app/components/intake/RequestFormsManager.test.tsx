// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createRequestForm,
    listRequestForms,
    rotateRequestFormLink,
    updateRequestForm,
    type RequestDeskForm,
    type RequestDeskFormLink,
} from "@/app/lib/mikeApi";
import { RequestFormsManager } from "./RequestFormsManager";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listRequestForms: vi.fn(),
    createRequestForm: vi.fn(),
    updateRequestForm: vi.fn(),
    rotateRequestFormLink: vi.fn(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
    usePathname: () => "/intake/forms",
}));

const ORG = "org-1";
const TOKEN = "B".repeat(43);

function makeForm(overrides: Partial<RequestDeskForm> = {}): RequestDeskForm {
    return {
        id: "form-1",
        org_id: ORG,
        title: "Legal request",
        intro: "",
        disclaimer: "Submitting this form does not create a lawyer-client relationship.",
        privacy_notice: "Harbour Legal controls the personal data you enter here.",
        privacy_policy_url: null,
        allowed_sender_domains: ["acme.example"],
        retention_days: 365,
        enabled: true,
        created_by: { user_id: "u1", email: "alex@example.com", display_name: "Alex Lawyer", is_member: true },
        token_rotated_at: null,
        created_at: "2026-11-01T10:00:00.000Z",
        updated_at: "2026-11-01T10:00:00.000Z",
        ...overrides,
    };
}

function makeLink(form: RequestDeskForm, token = TOKEN): RequestDeskFormLink {
    return { form, token, path: `/request/${token}` };
}

const list = vi.mocked(listRequestForms);
const create = vi.mocked(createRequestForm);
const update = vi.mocked(updateRequestForm);
const rotate = vi.mocked(rotateRequestFormLink);

beforeEach(() => {
    list.mockReset();
    create.mockReset();
    update.mockReset();
    rotate.mockReset();
    push.mockReset();
    // PageHeader's breadcrumbs measure themselves against a media query.
    vi.stubGlobal(
        "matchMedia",
        vi.fn().mockReturnValue({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }),
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("RequestFormsManager", () => {
    it("lists the organization's forms with their settings as plain text", async () => {
        list.mockResolvedValue({ forms: [makeForm(), makeForm({ id: "form-2", title: "Supplier questions", enabled: false, allowed_sender_domains: [] })] });
        render(<RequestFormsManager workspace={ORG} />);

        const first = await screen.findByRole("article", { name: "Legal request" });
        expect(within(first).getByText("Accepting requests")).toBeVisible();
        expect(within(first).getByText("acme.example")).toBeVisible();
        expect(within(first).getByText(/365 days unless taken on as a matter/)).toBeVisible();
        expect(within(first).getByText(/by Alex Lawyer/)).toBeVisible();
        const second = screen.getByRole("article", { name: "Supplier questions" });
        expect(within(second).getByText("Switched off")).toBeVisible();
        expect(within(second).getByText("Any email address")).toBeVisible();
        expect(within(second).getByRole("button", { name: "Switch on" })).toBeVisible();
        expect(list).toHaveBeenCalledWith(ORG, expect.any(AbortSignal));
    });

    it("creates a form and shows its link once, with a copy button", async () => {
        list.mockResolvedValue({ forms: [] });
        const created = makeForm({ id: "form-new", title: "Ask the legal team" });
        create.mockResolvedValue(makeLink(created));
        // user-event installs its own clipboard on setup; spy on that one.
        const user = userEvent.setup();
        const writeText = vi
            .spyOn(navigator.clipboard, "writeText")
            .mockResolvedValue(undefined);
        render(<RequestFormsManager workspace={ORG} />);

        expect(await screen.findByText("No request forms yet")).toBeVisible();
        await user.click(screen.getAllByRole("button", { name: "New form" })[0]);
        const dialog = screen.getByRole("dialog", { name: "New form" });
        await user.type(within(dialog).getByLabelText("Title"), "Ask the legal team");
        await user.clear(within(dialog).getByLabelText("Kept for (days)"));
        await user.type(within(dialog).getByLabelText("Kept for (days)"), "90");
        await user.type(
            within(dialog).getByLabelText("Accept requests from these email domains"),
            "acme.example, partners.example",
        );
        await user.click(within(dialog).getByRole("button", { name: "Create form" }));

        expect(create).toHaveBeenCalledWith(ORG, {
            title: "Ask the legal team",
            intro: "",
            disclaimer: "",
            privacy_notice: "",
            privacy_policy_url: null,
            allowed_sender_domains: "acme.example, partners.example",
            retention_days: 90,
        });
        const notice = await screen.findByRole("status");
        expect(within(notice).getByText("Form link for Ask the legal team")).toBeVisible();
        const url = `${window.location.origin}/request/${TOKEN}`;
        expect(within(notice).getByLabelText("Form link")).toHaveValue(url);
        await user.click(within(notice).getByRole("button", { name: "Copy link" }));
        expect(writeText).toHaveBeenCalledWith(url);
        expect(await within(notice).findByRole("button", { name: "Copied" })).toBeVisible();
        expect(screen.getByRole("article", { name: "Ask the legal team" })).toBeVisible();

        await user.click(within(notice).getByRole("button", { name: "Dismiss the form link" }));
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.queryByText(TOKEN, { exact: false })).toBeNull();
    });

    it("replaces a link after confirmation and shows the new one", async () => {
        const form = makeForm();
        list.mockResolvedValue({ forms: [form] });
        const rotated = makeForm({ token_rotated_at: "2026-11-08T12:00:00.000Z" });
        rotate.mockResolvedValue(makeLink(rotated, "C".repeat(43)));
        const user = userEvent.setup();
        render(<RequestFormsManager workspace={ORG} />);

        const card = await screen.findByRole("article", { name: "Legal request" });
        await user.click(within(card).getByRole("button", { name: "Replace link" }));
        const confirm = screen.getByRole("dialog", { name: "Replace the form link?" });
        expect(within(confirm).getByText(/stops working at once/)).toBeVisible();
        await user.click(within(confirm).getByRole("button", { name: "Replace link" }));

        await waitFor(() => expect(rotate).toHaveBeenCalledWith("form-1"));
        const notice = await screen.findByRole("status");
        expect(within(notice).getByLabelText("Form link")).toHaveValue(
            `${window.location.origin}/request/${"C".repeat(43)}`,
        );
        expect(within(card).getByText("Link replaced")).toBeVisible();
    });

    it("switches a form off after confirmation and back on without one", async () => {
        const form = makeForm();
        list.mockResolvedValue({ forms: [form] });
        update
            .mockResolvedValueOnce(makeForm({ enabled: false }))
            .mockResolvedValueOnce(makeForm({ enabled: true }));
        const user = userEvent.setup();
        render(<RequestFormsManager workspace={ORG} />);

        const card = await screen.findByRole("article", { name: "Legal request" });
        await user.click(within(card).getByRole("button", { name: "Switch off" }));
        await user.click(
            within(screen.getByRole("dialog", { name: "Switch the form off?" })).getByRole("button", {
                name: "Switch off",
            }),
        );
        await waitFor(() => expect(update).toHaveBeenCalledWith("form-1", { enabled: false }));
        expect(await within(card).findByText("Switched off")).toBeVisible();

        await user.click(within(card).getByRole("button", { name: "Switch on" }));
        await waitFor(() => expect(update).toHaveBeenCalledWith("form-1", { enabled: true }));
        expect(await within(card).findByText("Accepting requests")).toBeVisible();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("edits a form's notices and settings", async () => {
        const form = makeForm();
        list.mockResolvedValue({ forms: [form] });
        update.mockResolvedValue(makeForm({ title: "Renamed", retention_days: 30 }));
        const user = userEvent.setup();
        render(<RequestFormsManager workspace={ORG} />);

        const card = await screen.findByRole("article", { name: "Legal request" });
        await user.click(within(card).getByRole("button", { name: "Edit" }));
        const dialog = screen.getByRole("dialog", { name: "Edit form" });
        const title = within(dialog).getByLabelText("Title");
        await user.clear(title);
        await user.type(title, "Renamed");
        const retention = within(dialog).getByLabelText("Kept for (days)");
        await user.clear(retention);
        await user.type(retention, "30");
        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

        expect(update).toHaveBeenCalledWith("form-1", {
            title: "Renamed",
            intro: "",
            disclaimer: form.disclaimer,
            privacy_notice: form.privacy_notice,
            privacy_policy_url: null,
            allowed_sender_domains: "acme.example",
            retention_days: 30,
        });
        expect(await screen.findByRole("article", { name: "Renamed" })).toBeVisible();
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("shows a load failure with a retry, never an empty list", async () => {
        list.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ forms: [makeForm()] });
        const user = userEvent.setup();
        render(<RequestFormsManager workspace={ORG} />);

        expect(await screen.findByText("The request forms did not load")).toBeVisible();
        expect(screen.queryByText("No request forms yet")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("article", { name: "Legal request" })).toBeVisible();
    });
});
