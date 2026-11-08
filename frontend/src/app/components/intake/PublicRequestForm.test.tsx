// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    getPublicRequestForm,
    submitPublicRequestForm,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import { PublicRequestForm } from "./PublicRequestForm";
import { HUMAN_REPLY_NOTICE } from "./requestFormLabels";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getPublicRequestForm: vi.fn(),
    submitPublicRequestForm: vi.fn(),
}));

const TOKEN = "A".repeat(43);

function makeForm(overrides: Partial<RequestDeskPublicForm> = {}): RequestDeskPublicForm {
    return {
        organization: { name: "Harbour Legal", logo_data_url: null },
        title: "Legal request",
        intro: "Tell us what you need and by when.",
        disclaimer:
            "Submitting this form does not create a lawyer-client relationship, and nothing on this page is legal advice.",
        privacy_notice: "Harbour Legal controls the personal data you enter here.",
        privacy_policy_url: "https://harbour.example/privacy",
        retention_days: 180,
        restricts_sender_domains: false,
        ...overrides,
    };
}

const getForm = vi.mocked(getPublicRequestForm);
const submit = vi.mocked(submitPublicRequestForm);

beforeEach(() => {
    getForm.mockReset();
    submit.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("PublicRequestForm", () => {
    it("shows the organization, the editable notices, the privacy link and the retention period", async () => {
        getForm.mockResolvedValue(makeForm({ organization: { name: "Harbour Legal", logo_data_url: "data:image/png;base64,aGk=" } }));
        render(<PublicRequestForm token={TOKEN} />);

        expect(await screen.findByRole("heading", { level: 1, name: "Legal request" })).toBeVisible();
        expect(screen.getByText("Harbour Legal")).toBeVisible();
        expect(screen.getByText("Tell us what you need and by when.")).toBeVisible();
        expect(screen.getByText(/does not create a lawyer-client relationship/)).toBeVisible();
        expect(screen.getByText(HUMAN_REPLY_NOTICE)).toBeVisible();
        expect(screen.getByText(/Harbour Legal controls the personal data/)).toBeVisible();
        expect(screen.getByRole("link", { name: "Read the privacy policy" })).toHaveAttribute(
            "href",
            "https://harbour.example/privacy",
        );
        expect(screen.getByText(/deleted after 180 days/)).toBeVisible();
        // The organization's logo is decorative beside its name.
        expect(document.querySelector("img[alt='']")).toHaveAttribute("src", "data:image/png;base64,aGk=");
        expect(getForm).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal));
    });

    it("keeps the honeypot out of sight and out of the tab order", async () => {
        getForm.mockResolvedValue(makeForm());
        render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        const honeypot = document.querySelector("input[name='website']") as HTMLInputElement;
        expect(honeypot).not.toBeNull();
        expect(honeypot.tabIndex).toBe(-1);
        expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
        // Hidden from assistive technology: no textbox by that name is exposed.
        expect(screen.queryByRole("textbox", { name: "Leave this field empty" })).toBeNull();
    });

    it("sends the trimmed fields with an empty honeypot and shows the reference once", async () => {
        getForm.mockResolvedValue(makeForm({ restricts_sender_domains: true }));
        submit.mockResolvedValue({ reference: "REQ-12" });
        const user = userEvent.setup();
        render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        expect(screen.getByText(/Use your work email address/)).toBeVisible();
        const send = screen.getByRole("button", { name: "Send request" });
        expect(send).toBeDisabled();

        await user.type(screen.getByLabelText("What is the request about?"), "  NDA review ");
        await user.type(screen.getByLabelText("Details"), "Please review clause 4.");
        await user.type(screen.getByLabelText("Your name"), "Dana Client");
        await user.type(screen.getByLabelText("Your email address"), "dana@acme.example ");
        expect(send).toBeEnabled();
        await user.click(send);

        expect(submit).toHaveBeenCalledWith(TOKEN, {
            title: "NDA review",
            details: "Please review clause 4.",
            requester_name: "Dana Client",
            requester_email: "dana@acme.example",
            website: "",
        });
        const receipt = await screen.findByRole("heading", { name: "Your request has been received" });
        expect(receipt).toHaveFocus();
        expect(screen.getByText("REQ-12")).toBeVisible();
        expect(screen.getByText(/Keep this reference/)).toBeVisible();
        // The notices stay on the page after submitting.
        expect(screen.getByText(HUMAN_REPLY_NOTICE)).toBeVisible();
        expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
    });

    it("shows the server's correction inline and keeps what was typed", async () => {
        getForm.mockResolvedValue(makeForm());
        submit.mockRejectedValue(
            new MikeApiError({
                status: 400,
                code: "request_form_sender_not_allowed",
                message: "This form only accepts requests from approved email domains. Use your work email address.",
            }),
        );
        const user = userEvent.setup();
        render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        await user.type(screen.getByLabelText("What is the request about?"), "NDA review");
        await user.type(screen.getByLabelText("Details"), "Please review clause 4.");
        await user.type(screen.getByLabelText("Your name"), "Dana Client");
        await user.type(screen.getByLabelText("Your email address"), "dana@other.example");
        await user.click(screen.getByRole("button", { name: "Send request" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/approved email domains/);
        expect(screen.getByLabelText("Your email address")).toHaveValue("dana@other.example");
        expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    });

    it("shows one notice for an unknown, disabled or replaced link", async () => {
        getForm.mockRejectedValue(
            new MikeApiError({
                status: 404,
                code: "request_form_not_found",
                message: "This request form is not available.",
            }),
        );
        render(<PublicRequestForm token={TOKEN} />);
        expect(
            await screen.findByRole("heading", { level: 1, name: "This request form is not available" }),
        ).toBeVisible();
        expect(screen.getByText(/Ask the legal team for a current link/)).toBeVisible();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("says so and offers a retry when the form did not load", async () => {
        getForm
            .mockRejectedValueOnce(new MikeApiError({ status: 500, message: "Something went wrong." }))
            .mockResolvedValueOnce(makeForm());
        const user = userEvent.setup();
        render(<PublicRequestForm token={TOKEN} />);
        expect(
            await screen.findByRole("heading", { level: 1, name: "The request form did not load" }),
        ).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Try again" }));
        await waitFor(() => expect(getForm).toHaveBeenCalledTimes(2));
        expect(await screen.findByRole("heading", { level: 1, name: "Legal request" })).toBeVisible();
    });
});
