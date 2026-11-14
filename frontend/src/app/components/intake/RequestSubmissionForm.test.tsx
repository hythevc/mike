// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    submitPublicRequestForm,
    type RequestDeskFormReceipt,
    type RequestDeskPublicForm,
} from "@/app/lib/mikeApi";
import {
    RequestSubmissionForm,
    validateRequestFields,
    type RequestFieldValues,
} from "./RequestSubmissionForm";
import {
    ALL_FIELDS_REQUIRED,
    INVALID_EMAIL_ERROR,
    REQUEST_FIELD_COPY,
    REQUEST_FIELD_ERRORS,
    REQUEST_FIELD_MAX,
    REQUEST_FIELD_ORDER,
    REQUEST_NOT_SENT_TITLE,
    WORK_EMAIL_HINT,
    fieldsToCorrectLead,
} from "./requestFormLabels";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    submitPublicRequestForm: vi.fn(),
}));

const TOKEN = "A".repeat(43);
const submit = vi.mocked(submitPublicRequestForm);

function makeForm(overrides: Partial<RequestDeskPublicForm> = {}): RequestDeskPublicForm {
    return {
        organization: { name: "Harbour Legal", logo_data_url: null },
        title: "Legal request",
        intro: "",
        disclaimer: "Submitting this form does not create a lawyer-client relationship.",
        privacy_notice: "Harbour Legal controls the personal data you enter here.",
        privacy_policy_url: null,
        retention_days: 180,
        restricts_sender_domains: false,
        ...overrides,
    };
}

const VALID: RequestFieldValues = {
    title: "NDA review",
    details: "Please review clause 4.",
    name: "Dana Client",
    email: "dana@acme.example",
};

function renderForm(form = makeForm()) {
    const onSubmitted = vi.fn<(receipt: RequestDeskFormReceipt) => void>();
    const view = render(
        <RequestSubmissionForm token={TOKEN} form={form} onSubmitted={onSubmitted} />,
    );
    return { ...view, onSubmitted };
}

const control = (field: keyof RequestFieldValues) =>
    screen.getByLabelText(REQUEST_FIELD_COPY[field].label);
const sendButton = () => screen.getByRole("button", { name: "Send request" });
const summary = (container: HTMLElement) =>
    container.querySelector('[data-slot="request-error-summary"]') as HTMLElement | null;

/** The elements a control names in `aria-describedby`, in order. */
function describedBy(element: HTMLElement): HTMLElement[] {
    return (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id) as HTMLElement);
}

async function fillAll(user: ReturnType<typeof userEvent.setup>, values = VALID) {
    for (const field of REQUEST_FIELD_ORDER) {
        await user.type(control(field), values[field]);
    }
}

beforeEach(() => {
    submit.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("validateRequestFields", () => {
    it("passes a complete request", () => {
        expect(validateRequestFields(VALID)).toEqual({});
    });

    it("reports every missing field in the server's own words", () => {
        expect(validateRequestFields({ title: "", details: " ", name: "\n", email: "" })).toEqual({
            title: "Add a short title for your request.",
            details: "Describe what you need.",
            name: "Add your name.",
            email: "Add the email address the legal team should reply to.",
        });
    });

    it("reports a value that is too long, with its length, and cuts nothing", () => {
        const long = "x".repeat(REQUEST_FIELD_MAX.title + 50);
        expect(validateRequestFields({ ...VALID, title: long })).toEqual({
            title: "Keep the title to 200 characters. It has 250.",
        });
        expect(
            validateRequestFields({ ...VALID, details: "y".repeat(REQUEST_FIELD_MAX.details + 1) }),
        ).toEqual({ details: "Keep the details to 10,000 characters. It has 10,001." });
    });

    it("judges a value as it will be sent, without the spaces around it", () => {
        const padded = `  ${"x".repeat(REQUEST_FIELD_MAX.title)}  `;
        expect(validateRequestFields({ ...VALID, title: padded })).toEqual({});
        expect(validateRequestFields({ ...VALID, email: "  dana@acme.example " })).toEqual({});
    });

    it.each(["dana", "dana@", "dana@acme", "@acme.example", "dana @acme.example", "a@b@c.example"])(
        "refuses %s as an email address",
        (email) => {
            expect(validateRequestFields({ ...VALID, email })).toEqual({
                email: INVALID_EMAIL_ERROR,
            });
        },
    );
});

describe("RequestSubmissionForm", () => {
    it("keeps the Send button enabled before any field is filled", () => {
        renderForm();
        const send = sendButton();
        expect(send).toBeEnabled();
        expect(send).toHaveAttribute("type", "submit");
        expect(send).not.toHaveAttribute("aria-disabled");
        // 44px tall, and the one action the browser checks find by this slot.
        expect(send).toHaveAttribute("data-slot", "primary-action");
        expect(send.className.split(/\s+/)).toContain("h-11");
    });

    it("labels every field, says once that all are required, and sets autocomplete", () => {
        renderForm();
        expect(screen.getByText(ALL_FIELDS_REQUIRED)).toBeInTheDocument();
        for (const field of REQUEST_FIELD_ORDER) {
            const element = control(field);
            expect(element).toBeRequired();
            expect(element).toHaveAttribute("name", field);
            expect(element).not.toHaveAttribute("aria-invalid");
            // Nothing is cut to fit and no hint hides once typing starts.
            expect(element).not.toHaveAttribute("maxlength");
            expect(element).not.toHaveAttribute("placeholder");
        }
        expect(control("name")).toHaveAttribute("autocomplete", "name");
        expect(control("email")).toHaveAttribute("autocomplete", "email");
        expect(control("email")).toHaveAttribute("type", "email");
        expect(control("email")).toHaveAttribute("inputmode", "email");
        expect(control("email")).toHaveAttribute("spellcheck", "false");
        // The request's own words are not something a browser should offer back.
        expect(control("title")).toHaveAttribute("autocomplete", "off");
        expect(control("details")).toHaveAttribute("autocomplete", "off");
    });

    it("ties each hint to its field", () => {
        renderForm();
        for (const field of ["title", "details"] as const) {
            const hints = describedBy(control(field));
            expect(hints).toHaveLength(1);
            expect(hints[0]).toHaveTextContent(REQUEST_FIELD_COPY[field].hint);
            expect(hints[0]).toBeVisible();
        }
        expect(control("name")).not.toHaveAttribute("aria-describedby");
        expect(control("email")).not.toHaveAttribute("aria-describedby");
    });

    it("asks for a work address on a form that accepts approved domains only", () => {
        renderForm(makeForm({ restricts_sender_domains: true }));
        const hints = describedBy(control("email"));
        expect(hints).toHaveLength(1);
        expect(hints[0]).toHaveTextContent(WORK_EMAIL_HINT);
    });

    it("on an empty submit, focuses a summary and marks each field with a visible, linked message", async () => {
        const user = userEvent.setup();
        const { container, onSubmitted } = renderForm();
        expect(summary(container)).toBeNull();

        await user.click(sendButton());

        // Nothing was sent.
        expect(submit).not.toHaveBeenCalled();
        expect(onSubmitted).not.toHaveBeenCalled();

        // The summary takes focus and says what did not happen.
        const box = summary(container)!;
        expect(box).toHaveFocus();
        expect(box).toHaveAttribute("tabindex", "-1");
        const alert = within(box).getByRole("alert");
        expect(within(alert).getByRole("heading", { name: REQUEST_NOT_SENT_TITLE })).toBeVisible();
        expect(alert).toHaveTextContent(fieldsToCorrectLead(4));

        // One link per field, in the form's order, in the field's own words.
        const links = within(alert).getAllByRole("link");
        expect(links.map((link) => link.textContent)).toEqual(
            REQUEST_FIELD_ORDER.map((field) => REQUEST_FIELD_ERRORS[field].missing),
        );
        REQUEST_FIELD_ORDER.forEach((field, index) => {
            expect(links[index]).toHaveAttribute("href", `#${control(field).id}`);
        });

        // Each field is marked invalid and described by its visible message.
        for (const field of REQUEST_FIELD_ORDER) {
            const element = control(field);
            expect(element).toHaveAttribute("aria-invalid", "true");
            const message = describedBy(element).at(-1)!;
            expect(message).toBeVisible();
            expect(message).toHaveTextContent(REQUEST_FIELD_ERRORS[field].missing);
            // Not by colour alone: an icon, and a word for screen readers.
            expect(message.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
            expect(message).toHaveTextContent(/^Error:/);
            // The message sits in the field's own block, right under it.
            expect(element.closest("[data-request-field]")).toContainElement(message);
        }
        // A field with a hint keeps it, before its message.
        expect(describedBy(control("title")).map((node) => node.textContent)).toEqual([
            REQUEST_FIELD_COPY.title.hint,
            `Error: ${REQUEST_FIELD_ERRORS.title.missing}`,
        ]);
        // The button is still there to press again.
        expect(sendButton()).toBeEnabled();
    });

    it("takes the requester from a summary link to its field", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        await user.click(sendButton());
        const links = within(summary(container)!).getAllByRole("link");
        await user.click(links[2]);
        expect(control("name")).toHaveFocus();
        // The page does not jump to a fragment; the field has the focus.
        expect(window.location.hash).toBe("");
    });

    it("lists only the fields that need correcting", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        await user.type(control("title"), VALID.title);
        await user.type(control("details"), VALID.details);
        await user.type(control("name"), VALID.name);
        await user.type(control("email"), "dana@acme");
        await user.click(sendButton());

        const box = summary(container)!;
        expect(box).toHaveFocus();
        expect(box).toHaveTextContent(fieldsToCorrectLead(1));
        const links = within(box).getAllByRole("link");
        expect(links.map((link) => link.textContent)).toEqual([INVALID_EMAIL_ERROR]);
        expect(control("email")).toHaveAttribute("aria-invalid", "true");
        for (const field of ["title", "details", "name"] as const) {
            expect(control(field)).not.toHaveAttribute("aria-invalid");
        }
        // Everything typed is still there.
        expect(control("email")).toHaveValue("dana@acme");
        expect(control("details")).toHaveValue(VALID.details);
        expect(submit).not.toHaveBeenCalled();
    });

    it("clears a field's message when the field is edited, and keeps the summary until the next attempt", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        await user.click(sendButton());
        expect(control("title")).toHaveAttribute("aria-invalid", "true");

        await user.type(control("title"), "N");
        expect(control("title")).not.toHaveAttribute("aria-invalid");
        expect(describedBy(control("title")).map((node) => node.textContent)).toEqual([
            REQUEST_FIELD_COPY.title.hint,
        ]);
        // The other fields keep theirs, and so does the record of the attempt.
        expect(control("details")).toHaveAttribute("aria-invalid", "true");
        expect(within(summary(container)!).getAllByRole("link")).toHaveLength(4);

        // The next attempt replaces it and takes focus again.
        await user.click(sendButton());
        const box = summary(container)!;
        expect(box).toHaveFocus();
        expect(within(box).getAllByRole("link")).toHaveLength(3);
    });

    it("never blocks paste and never cuts what was pasted", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        const long = "x".repeat(REQUEST_FIELD_MAX.title + 50);
        const title = control("title");
        await user.click(title);
        await user.paste(long);
        expect(title).toHaveValue(long);

        // A paste event is not cancelled by the form.
        const event = new Event("paste", { bubbles: true, cancelable: true });
        expect(title.dispatchEvent(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);

        await user.type(control("details"), VALID.details);
        await user.type(control("name"), VALID.name);
        await user.type(control("email"), VALID.email);
        await user.click(sendButton());

        // Too long is said, with the length, and the text stays whole.
        expect(submit).not.toHaveBeenCalled();
        expect(summary(container)).toHaveTextContent(
            "Keep the title to 200 characters. It has 250.",
        );
        expect(title).toHaveValue(long);
        expect(title).toHaveAttribute("aria-invalid", "true");
    });

    it("sends the trimmed fields with an empty honeypot, once", async () => {
        submit.mockResolvedValue({ reference: "REQ-12" });
        const user = userEvent.setup();
        const { container, onSubmitted } = renderForm();
        await user.type(control("title"), "  NDA review ");
        await user.type(control("details"), VALID.details);
        await user.type(control("name"), VALID.name);
        await user.type(control("email"), "dana@acme.example ");
        await user.click(sendButton());

        await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ reference: "REQ-12" }));
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(TOKEN, {
            title: "NDA review",
            details: VALID.details,
            requester_name: VALID.name,
            requester_email: VALID.email,
            website: "",
        });
        expect(summary(container)).toBeNull();
    });

    it("can be sent with the keyboard alone", async () => {
        submit.mockResolvedValue({ reference: "REQ-13" });
        const user = userEvent.setup();
        const { onSubmitted } = renderForm();
        await fillAll(user);
        // Enter in a one-line field submits the form.
        await user.type(control("email"), "{Enter}");
        await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    });

    it("disables the button only while the request is on its way", async () => {
        let resolve!: (receipt: RequestDeskFormReceipt) => void;
        submit.mockReturnValue(
            new Promise<RequestDeskFormReceipt>((done) => {
                resolve = done;
            }),
        );
        const user = userEvent.setup();
        const { onSubmitted } = renderForm();
        await fillAll(user);
        expect(sendButton()).toBeEnabled();
        await user.click(sendButton());

        const sending = await screen.findByRole("button", { name: "Sending…" });
        expect(sending).toBeDisabled();
        expect(sending).toHaveAttribute("aria-busy", "true");
        // A second press, or Enter, sends nothing more.
        fireEvent.submit(sending.closest("form")!);
        expect(submit).toHaveBeenCalledTimes(1);

        resolve({ reference: "REQ-14" });
        await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ reference: "REQ-14" }));
    });

    it("shows the server's correction for the email address on that field", async () => {
        const detail =
            "This form only accepts requests from approved email domains. Use your work email address.";
        submit.mockRejectedValue(
            new MikeApiError({
                status: 400,
                code: "request_form_sender_not_allowed",
                message: detail,
            }),
        );
        const user = userEvent.setup();
        const { container, onSubmitted } = renderForm();
        await fillAll(user, { ...VALID, email: "dana@other.example" });
        await user.click(sendButton());

        const box = await waitFor(() => {
            const found = summary(container);
            expect(found).not.toBeNull();
            return found!;
        });
        await waitFor(() => expect(box).toHaveFocus());
        expect(within(box).getAllByRole("link").map((link) => link.textContent)).toEqual([detail]);
        const email = control("email");
        expect(email).toHaveAttribute("aria-invalid", "true");
        expect(describedBy(email).at(-1)).toHaveTextContent(detail);
        // What was typed stays, and the request can be sent again.
        expect(email).toHaveValue("dana@other.example");
        expect(sendButton()).toBeEnabled();
        expect(onSubmitted).not.toHaveBeenCalled();
    });

    it("says so in the summary when the request could not be sent for another reason", async () => {
        submit.mockRejectedValue(new MikeApiError({ status: 500, message: "stack trace here" }));
        const user = userEvent.setup();
        const { container } = renderForm();
        await fillAll(user);
        await user.click(sendButton());

        const box = await waitFor(() => {
            const found = summary(container);
            expect(found).not.toBeNull();
            return found!;
        });
        await waitFor(() => expect(box).toHaveFocus());
        expect(within(box).getByRole("heading", { name: REQUEST_NOT_SENT_TITLE })).toBeVisible();
        // A cause and a next step in the product's words, never the server's.
        expect(box).not.toHaveTextContent("stack trace here");
        expect(box.textContent).toMatch(/try again/i);
        expect(within(box).queryByRole("link")).toBeNull();
        for (const field of REQUEST_FIELD_ORDER) {
            expect(control(field)).not.toHaveAttribute("aria-invalid");
            expect(control(field)).toHaveValue(VALID[field]);
        }
        expect(sendButton()).toBeEnabled();
    });

    it("moves focus to the summary again after a second failed attempt", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        await user.click(sendButton());
        expect(summary(container)).toHaveFocus();

        await user.click(control("title"));
        expect(control("title")).toHaveFocus();
        await user.click(sendButton());
        expect(summary(container)).toHaveFocus();
    });

    it("keeps the honeypot out of sight, out of the tab order and out of the summary", async () => {
        const user = userEvent.setup();
        const { container } = renderForm();
        const honeypot = container.querySelector("input[name='website']") as HTMLInputElement;
        expect(honeypot.tabIndex).toBe(-1);
        expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
        await user.click(sendButton());
        expect(within(summary(container)!).getAllByRole("link")).toHaveLength(
            REQUEST_FIELD_ORDER.length,
        );
    });
});
