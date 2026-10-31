// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocResult } from "@/app/hooks/useFetchSingleDoc";
import { PdfView } from "./PdfView";

type FetchState = { result: DocResult; loading: boolean; error: string | null };

const mocks = vi.hoisted(() => ({
    refetchKeys: [] as unknown[],
    stateFor: (() => ({
        result: null,
        loading: false,
        error: null,
    })) as (refetchKey: unknown) => FetchState,
    getDocument: vi.fn(),
    downloadDocumentFile: vi.fn(),
}));

vi.mock("@/app/hooks/useFetchSingleDoc", () => ({
    useFetchSingleDoc: (
        _documentId: string | null,
        _versionId: string | null,
        _displayUrl: string | null | undefined,
        refetchKey: unknown,
    ) => {
        mocks.refetchKeys.push(refetchKey);
        return mocks.stateFor(refetchKey);
    },
}));
vi.mock("./highlightQuote", () => ({
    getPdfJs: async () => ({
        getDocument: mocks.getDocument,
        TextLayer: { cleanup: vi.fn() },
    }),
    clearHighlights: vi.fn(),
    highlightQuote: vi.fn(),
    STANDARD_FONT_DATA_URL: "/standard_fonts/",
}));
vi.mock("@/app/lib/downloadDocument", () => ({
    downloadDocumentFile: (...args: unknown[]) =>
        mocks.downloadDocumentFile(...args),
}));

const pdf: DocResult = { type: "pdf", buffer: new ArrayBuffer(4) };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetchKeys = [];
    mocks.downloadDocumentFile.mockResolvedValue(undefined);
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
});

const view = (props: Partial<Parameters<typeof PdfView>[0]> = {}) => (
    <PdfView
        doc={{ document_id: "document-1", version_id: "version-1" }}
        {...props}
    />
);

describe("PdfView states", () => {
    it("gives its loading spinner an accessible name", () => {
        mocks.stateFor = () => ({ result: null, loading: true, error: null });
        render(view());

        expect(
            screen.getByRole("status", { name: "Loading document" }),
        ).toBeInTheDocument();
    });

    it("announces a failed load and offers Retry and the file itself", async () => {
        mocks.stateFor = () => ({
            result: null,
            loading: false,
            error: "Failed to load document.",
        });
        render(view());

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Failed to load document.",
        );
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();

        fireEvent.click(screen.getByRole("button", { name: "Download file" }));
        await waitFor(() =>
            expect(mocks.downloadDocumentFile).toHaveBeenCalledWith(
                "document-1",
                "version-1",
            ),
        );
    });

    it("loads the document again on Retry", async () => {
        mocks.stateFor = (refetchKey) =>
            refetchKey === undefined
                ? { result: null, loading: false, error: "Failed to load document." }
                : { result: pdf, loading: false, error: null };
        mocks.getDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: vi.fn().mockResolvedValue({
                    getViewport: () => ({ width: 100, height: 100 }),
                }),
            }),
            destroy: vi.fn().mockResolvedValue(undefined),
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        render(view());

        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(mocks.refetchKeys.at(-1)).not.toBeUndefined();
        await waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());
    });

    it("offers the same recovery when the PDF itself cannot be read", async () => {
        mocks.stateFor = () => ({ result: pdf, loading: false, error: null });
        mocks.getDocument.mockReturnValue({
            promise: Promise.reject(new Error("bad xref table")),
            destroy: vi.fn().mockResolvedValue(undefined),
        });
        render(view());

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Failed to load document.");
        expect(alert).not.toHaveTextContent("bad xref table");
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
        expect(
            screen.getByRole("button", { name: "Download file" }),
        ).toBeVisible();
    });

    it("links the download to the display address when there is one", () => {
        mocks.stateFor = () => ({
            result: null,
            loading: false,
            error: "Failed to load document.",
        });
        render(view({ displayUrl: "/api/workflows/addons/w1/assets/a1/display" }));

        const container = screen.getByRole("alert").parentElement as HTMLElement;
        expect(
            within(container).getByRole("link", { name: "Download file" }),
        ).toHaveAttribute("href", "/api/workflows/addons/w1/assets/a1/display");
    });

    it("says why a download failed", async () => {
        const notify = await import("@/app/lib/userFacingError");
        const notifyError = vi.spyOn(notify, "notifyError");
        mocks.downloadDocumentFile.mockRejectedValue(new TypeError("Failed to fetch"));
        mocks.stateFor = () => ({
            result: null,
            loading: false,
            error: "Failed to load document.",
        });
        render(view());

        fireEvent.click(screen.getByRole("button", { name: "Download file" }));

        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(expect.any(TypeError), {
                action: "download the document",
            }),
        );
    });
});
