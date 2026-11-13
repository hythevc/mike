// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getJurisdictionRegistry,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";
import {
    clearJurisdictionRegistryCache,
    useJurisdictionRegistry,
} from "./useJurisdictionRegistry";

vi.mock("@/app/lib/mikeApi", () => ({
    getJurisdictionRegistry: vi.fn(),
}));

const registry: JurisdictionRegistry = {
    jurisdictions: [
        { code: "US", name: "United States", kind: "country", parent: null, languages: ["en"] },
        { code: "US_CA", name: "California", kind: "subdivision", parent: "US", languages: ["en"] },
    ],
    working_languages: [{ code: "en-US", name: "American English" }],
    max_jurisdictions: 10,
};

describe("useJurisdictionRegistry", () => {
    beforeEach(() => {
        clearJurisdictionRegistryCache();
        vi.mocked(getJurisdictionRegistry).mockReset();
    });

    it("is null until the registry arrives, then holds it", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const { result } = renderHook(() => useJurisdictionRegistry());
        expect(result.current.registry).toBeNull();
        expect(result.current.error).toBeNull();
        await waitFor(() => expect(result.current.registry).toEqual(registry));
        expect(result.current.error).toBeNull();
    });

    it("reads once for everything that asks at the same time", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const first = renderHook(() => useJurisdictionRegistry());
        const second = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(first.result.current.registry).toEqual(registry));
        await waitFor(() => expect(second.result.current.registry).toEqual(registry));
        expect(getJurisdictionRegistry).toHaveBeenCalledTimes(1);
    });

    it("serves a later mount from what was read, without asking again", async () => {
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const first = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(first.result.current.registry).toEqual(registry));
        first.unmount();

        const later = renderHook(() => useJurisdictionRegistry());
        // There on the first render: no placeholder, no second request.
        expect(later.result.current.registry).toEqual(registry);
        expect(getJurisdictionRegistry).toHaveBeenCalledTimes(1);
    });

    it("reports a failed read and does not keep it", async () => {
        const failure = new Error("offline");
        vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(failure);
        const { result } = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(result.current.error).toBe(failure));
        expect(result.current.registry).toBeNull();

        // The next thing to ask reads again rather than getting the failure.
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        const next = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(next.result.current.registry).toEqual(registry));
        expect(getJurisdictionRegistry).toHaveBeenCalledTimes(2);
    });

    it("reads again on retry and clears the error", async () => {
        vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(new Error("offline"));
        const { result } = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(result.current.error).not.toBeNull());

        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        act(() => result.current.retry());
        expect(result.current.error).toBeNull();
        await waitFor(() => expect(result.current.registry).toEqual(registry));
        expect(getJurisdictionRegistry).toHaveBeenCalledTimes(2);
    });

    it("reports a rejection that carries no reason as an error all the same", async () => {
        vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(undefined);
        const { result } = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    });

    it("gives the registry to everything showing the failure once one of them reads it", async () => {
        vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(new Error("offline"));
        const form = renderHook(() => useJurisdictionRegistry());
        const chips = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(form.result.current.error).not.toBeNull());
        await waitFor(() => expect(chips.result.current.error).not.toBeNull());

        // "Try again" is pressed in one place only.
        vi.mocked(getJurisdictionRegistry).mockResolvedValue(registry);
        act(() => form.result.current.retry());
        await waitFor(() => expect(form.result.current.registry).toEqual(registry));

        // The other has it too, and no longer reports a failure.
        expect(chips.result.current.registry).toEqual(registry);
        expect(chips.result.current.error).toBeNull();
        expect(getJurisdictionRegistry).toHaveBeenCalledTimes(2);
    });

    it("keeps reporting the failure in a place that did not retry while a retry elsewhere is on its way", async () => {
        vi.mocked(getJurisdictionRegistry).mockRejectedValueOnce(new Error("offline"));
        const form = renderHook(() => useJurisdictionRegistry());
        const chips = renderHook(() => useJurisdictionRegistry());
        await waitFor(() => expect(chips.result.current.error).not.toBeNull());

        vi.mocked(getJurisdictionRegistry).mockReturnValue(new Promise(() => {}));
        act(() => form.result.current.retry());
        expect(form.result.current.error).toBeNull();
        expect(chips.result.current.error).not.toBeNull();
        expect(chips.result.current.registry).toBeNull();
    });

    it("ignores a read that lands after the component has gone", async () => {
        let resolve!: (value: JurisdictionRegistry) => void;
        vi.mocked(getJurisdictionRegistry).mockReturnValue(
            new Promise((done) => {
                resolve = done;
            }),
        );
        const { result, unmount } = renderHook(() => useJurisdictionRegistry());
        unmount();
        await act(async () => {
            resolve(registry);
        });
        expect(result.current.registry).toBeNull();
        // It was still worth keeping for whoever asks next.
        const later = renderHook(() => useJurisdictionRegistry());
        expect(later.result.current.registry).toEqual(registry);
    });
});
