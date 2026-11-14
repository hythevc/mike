// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    getPublicRequestForm,
    submitPublicRequestForm,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import { PublicRequestForm } from "./PublicRequestForm";
import {
    FORM_LOADING_LABEL,
    HUMAN_REPLY_NOTICE,
    NOTICES_AFTER_HEADING,
    NOTICES_BEFORE_HEADING,
    RECEIPT_KEEP_REFERENCE,
    RECEIPT_TITLE,
    REQUEST_NOT_SENT_TITLE,
    organizationNoticeLead,
    retentionNotice,
} from "./requestFormLabels";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getPublicRequestForm: vi.fn(),
    submitPublicRequestForm: vi.fn(),
}));

const TOKEN = "A".repeat(43);

const DISCLAIMER =
    "Submitting this form does not create a lawyer-client relationship, and nothing on this page is legal advice. Our team reads requests on working days and replies by email.";
const PRIVACY = "Harbour Legal controls the personal data you enter here.";

function makeForm(overrides: Partial<RequestDeskPublicForm> = {}): RequestDeskPublicForm {
    return {
        organization: { name: "Harbour Legal", logo_data_url: null },
        title: "Legal request",
        intro: "Tell us what you need and by when.",
        disclaimer: DISCLAIMER,
        privacy_notice: PRIVACY,
        privacy_policy_url: "https://harbour.example/privacy",
        retention_days: 180,
        restricts_sender_domains: false,
        ...overrides,
    };
}

const getForm = vi.mocked(getPublicRequestForm);
const submit = vi.mocked(submitPublicRequestForm);

/** How many elements show exactly this text. */
const timesShown = (text: string) => screen.queryAllByText(text).length;

async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("What is the request about?"), "NDA review");
    await user.type(screen.getByLabelText("Details"), "Please review clause 4.");
    await user.type(screen.getByLabelText("Your name"), "Dana Client");
    await user.type(screen.getByLabelText("Your email address"), "dana@acme.example");
    await user.click(screen.getByRole("button", { name: "Send request" }));
}

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
        // The organization's logo is decorative beside its name, and has its
        // size stated so the page does not shift when it arrives.
        const logo = document.querySelector("img[alt='']") as HTMLImageElement;
        expect(logo).toHaveAttribute("src", "data:image/png;base64,aGk=");
        expect(logo).toHaveAttribute("width", "48");
        expect(logo).toHaveAttribute("height", "48");
        expect(getForm).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal));
    });

    it("says it is loading while the form is fetched", () => {
        getForm.mockReturnValue(new Promise(() => {}));
        const { container } = render(<PublicRequestForm token={TOKEN} />);
        expect(screen.getByText(FORM_LOADING_LABEL)).toBeVisible();
        expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
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

    it("lets the requester press Send before anything is filled in, and says what is missing", async () => {
        getForm.mockResolvedValue(makeForm());
        const user = userEvent.setup();
        const { container } = render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        // Enabled from the start: pressing it is how to find out what is missing.
        const send = screen.getByRole("button", { name: "Send request" });
        expect(send).toBeEnabled();
        await user.click(send);

        const summary = container.querySelector(
            '[data-slot="request-error-summary"]',
        ) as HTMLElement;
        expect(summary).toHaveFocus();
        expect(
            within(summary).getByRole("heading", { name: REQUEST_NOT_SENT_TITLE }),
        ).toBeVisible();
        expect(within(summary).getAllByRole("link")).toHaveLength(4);
        for (const label of [
            "What is the request about?",
            "Details",
            "Your name",
            "Your email address",
        ]) {
            const field = screen.getByLabelText(label);
            expect(field).toHaveAttribute("aria-invalid", "true");
            const ids = (field.getAttribute("aria-describedby") ?? "").split(/\s+/);
            const message = document.getElementById(ids.at(-1)!)!;
            expect(message).toBeVisible();
            expect(message.textContent).toMatch(/^Error: \S/);
        }
        expect(submit).not.toHaveBeenCalled();
        // Still the form, not a receipt.
        expect(screen.queryByRole("heading", { name: RECEIPT_TITLE })).toBeNull();
        expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    });

    it("gives the name and email fields their autocomplete hints", async () => {
        getForm.mockResolvedValue(makeForm());
        render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });
        expect(screen.getByLabelText("Your name")).toHaveAttribute("autocomplete", "name");
        expect(screen.getByLabelText("Your email address")).toHaveAttribute(
            "autocomplete",
            "email",
        );
    });

    it("shows each notice, the privacy sentence included, exactly once before sending", async () => {
        getForm.mockResolvedValue(makeForm());
        const { container } = render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        expect(container.querySelectorAll('[data-slot="request-form-notices"]')).toHaveLength(1);
        expect(timesShown(DISCLAIMER)).toBe(1);
        expect(timesShown(HUMAN_REPLY_NOTICE)).toBe(1);
        expect(timesShown(retentionNotice(180))).toBe(1);
        expect(screen.getAllByText(new RegExp(`^${PRIVACY}`))).toHaveLength(1);
        expect(document.body.textContent!.split(PRIVACY)).toHaveLength(2);
        expect(screen.getAllByRole("link", { name: "Read the privacy policy" })).toHaveLength(1);

        // They sit above the button they inform, under their own heading.
        const notices = screen.getByRole("region", { name: NOTICES_BEFORE_HEADING });
        const send = screen.getByRole("button", { name: "Send request" });
        expect(send.closest("form")).toContainElement(notices);
        expect(
            notices.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("sends the trimmed fields with an empty honeypot and shows the reference once", async () => {
        getForm.mockResolvedValue(makeForm({ restricts_sender_domains: true }));
        submit.mockResolvedValue({ reference: "REQ-12" });
        const user = userEvent.setup();
        render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });

        expect(screen.getByText(/Use your work email address/)).toBeVisible();
        const send = screen.getByRole("button", { name: "Send request" });
        // Enabled before and after the fields are filled; it is disabled only
        // while a request is on its way.
        expect(send).toBeEnabled();

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
        expect(screen.getAllByText("REQ-12")).toHaveLength(1);
        expect(screen.getByText(/Keep this reference/)).toBeVisible();
        // The notices stay on the page after submitting.
        expect(screen.getByText(HUMAN_REPLY_NOTICE)).toBeVisible();
        expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
    });

    it("says what happens next in the organization's own words, with the reference and no invented time", async () => {
        getForm.mockResolvedValue(makeForm());
        submit.mockResolvedValue({ reference: "REQ-12" });
        const user = userEvent.setup();
        const { container } = render(<PublicRequestForm token={TOKEN} />);
        await screen.findByRole("heading", { level: 1, name: "Legal request" });
        await fillAndSend(user);

        const receipt = (
            await screen.findByRole("heading", { level: 2, name: RECEIPT_TITLE })
        ).closest("section") as HTMLElement;
        // The reference, and why to keep it.
        expect(within(receipt).getByText("REQ-12").tagName).toBe("STRONG");
        expect(within(receipt).getByText(RECEIPT_KEEP_REFERENCE)).toBeVisible();

        // What happens next: the organization's notice, named as theirs.
        const next = within(receipt).getByRole("region", { name: NOTICES_AFTER_HEADING });
        expect(within(next).getByRole("heading", { level: 3 })).toHaveTextContent(
            NOTICES_AFTER_HEADING,
        );
        expect(within(next).getByText(organizationNoticeLead("Harbour Legal"))).toBeVisible();
        expect(within(next).getByText(DISCLAIMER)).toBeVisible();
        // The first thing under the heading is theirs, not the product's.
        expect(next.children[1]).toHaveTextContent(DISCLAIMER);

        // The product adds no time and no channel of its own: every digit and
        // every promise on the receipt is the reference, the organization's
        // wording or the retention period the organization set.
        const own = [
            RECEIPT_TITLE,
            RECEIPT_KEEP_REFERENCE,
            NOTICES_AFTER_HEADING,
            HUMAN_REPLY_NOTICE,
            organizationNoticeLead(""),
        ].join(" ");
        expect(own).not.toMatch(/\d/);
        expect(own).not.toMatch(
            /\b(?:within|hours?|days?|business|working|shortly|soon|promptly|by email|by phone|call)\b/i,
        );

        // Each notice, the privacy sentence included, still exactly once.
        expect(container.querySelectorAll('[data-slot="request-form-notices"]')).toHaveLength(1);
        expect(timesShown(DISCLAIMER)).toBe(1);
        expect(timesShown(HUMAN_REPLY_NOTICE)).toBe(1);
        expect(document.body.textContent!.split(PRIVACY)).toHaveLength(2);
        expect(screen.getAllByRole("link", { name: "Read the privacy policy" })).toHaveLength(1);
        expect(screen.queryByRole("region", { name: NOTICES_BEFORE_HEADING })).toBeNull();
        // The form is gone: nothing can be sent twice from the receipt.
        expect(container.querySelector("form")).toBeNull();
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
        expect(screen.getByLabelText("Your email address")).toHaveAttribute("aria-invalid", "true");
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
        const retry = screen.getByRole("button", { name: "Try again" });
        // The page's one action in this state, at the same 44px.
        expect(retry).toHaveAttribute("data-slot", "primary-action");
        expect(retry.className.split(/\s+/)).toContain("h-11");
        await user.click(retry);
        await waitFor(() => expect(getForm).toHaveBeenCalledTimes(2));
        expect(await screen.findByRole("heading", { level: 1, name: "Legal request" })).toBeVisible();
    });
});
