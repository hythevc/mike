import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@/shared/ui/ToastUI";
import { ANSWER_DISCLAIMER_TEXT } from "@/shared/ui/AnswerDisclaimerUI";
import { UNCITED_ANSWER_LABEL } from "./message/citationLabels";
import { AssistantMessage } from "./AssistantMessage";

describe("AssistantMessage documents-only grounding (W25)", () => {
    it("renders the not-in-documents answer and the disclaimer", () => {
        render(
            <AssistantMessage
                events={[
                    { type: "content", text: "Not in these documents." },
                    { type: "answer_grounding", scope: "documents", status: "not_found" },
                ]}
            />,
        );
        expect(screen.getByText(/Not in these documents\./)).toBeVisible();
        expect(screen.getByText(ANSWER_DISCLAIMER_TEXT)).toBeVisible();
    });

    it("warns when a finished answer cites no document", () => {
        render(
            <AssistantMessage
                events={[
                    { type: "content", text: "The term is 12 months." },
                    { type: "answer_grounding", scope: "documents", status: "uncited" },
                ]}
            />,
        );
        expect(screen.getByText(UNCITED_ANSWER_LABEL)).toBeVisible();
        expect(screen.getByText(ANSWER_DISCLAIMER_TEXT)).toBeVisible();
    });

    it("does not warn or disclaim a cited answer's prose, but still disclaims", () => {
        render(
            <AssistantMessage
                events={[
                    { type: "content", text: "The term is 12 months." },
                    { type: "answer_grounding", scope: "documents", status: "cited" },
                ]}
            />,
        );
        expect(screen.queryByText(UNCITED_ANSWER_LABEL)).not.toBeInTheDocument();
        expect(screen.getByText(ANSWER_DISCLAIMER_TEXT)).toBeVisible();
    });

    it("never shows the disclaimer while an answer is streaming", () => {
        render(
            <AssistantMessage
                isStreaming
                events={[{ type: "content", text: "Streaming…" }]}
            />,
        );
        expect(
            screen.queryByText(ANSWER_DISCLAIMER_TEXT),
        ).not.toBeInTheDocument();
    });
});

describe("AssistantMessage copy", () => {
    beforeEach(() => clearToasts());

    afterEach(() => {
        clearToasts();
        vi.restoreAllMocks();
    });

    it("tells the user when the clipboard refuses the copy", async () => {
        const user = userEvent.setup();
        // jsdom has no ClipboardItem; give the handler one so the failure
        // under test is the clipboard write itself, as it is in a browser.
        vi.stubGlobal(
            "ClipboardItem",
            class {
                constructor(public items: Record<string, Blob>) {}
            },
        );
        const write = vi
            .fn()
            .mockRejectedValue(
                new DOMException("Write permission denied.", "NotAllowedError"),
            );
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { ...navigator.clipboard, write },
        });

        render(
            <>
                <AssistantMessage
                    events={[{ type: "content", text: "The answer." }]}
                />
                <ToastViewportUI />
            </>,
        );

        await user.click(screen.getByRole("button", { name: "Copy response" }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't copy this answer");
        expect(alert).toHaveTextContent("clipboard permission");
        expect(alert).not.toHaveTextContent("Write permission denied.");
        expect(
            screen.queryByRole("button", { name: "Response copied" }),
        ).not.toBeInTheDocument();
        vi.unstubAllGlobals();
    });
});

describe("AssistantMessage web sources", () => {
    it("lists a page cited by several steps once, keeping its title", async () => {
        const user = userEvent.setup();
        render(
            <AssistantMessage
                events={[
                    {
                        type: "web_sources",
                        sources: [{ url: "https://law.test/s172" }],
                    },
                    { type: "content", text: "The answer." },
                    {
                        type: "web_sources",
                        sources: [
                            { url: "https://law.test/s172", title: "Section 172" },
                            { url: "https://law.test/s171", title: "Section 171" },
                        ],
                    },
                ]}
            />,
        );

        const toggle = screen.getByRole("button", { name: /Sources/ });
        expect(toggle).toHaveTextContent("2 web pages");
        await user.click(toggle);
        expect(screen.getByText("Section 172")).toBeInTheDocument();
    });
});
