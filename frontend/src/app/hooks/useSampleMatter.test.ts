// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    findOrCreateSampleMatter,
    SAMPLE_MATTER_NAME,
    SAMPLE_MATTER_NUMBER,
    SAMPLE_MATTER_TEMPLATE_IDS,
    useSampleMatter,
} from "./useSampleMatter";
import {
    createProject,
    listProjects,
    uploadProjectDocument,
} from "@/app/lib/mikeApi";
import type { Project } from "@/app/components/shared/types";
import { fetchPresetTemplateFile } from "@/app/components/library/presetTemplates";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspaceParam: () => undefined,
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    uploadProjectDocument: vi.fn(),
}));

vi.mock("@/app/components/library/presetTemplates", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@/app/components/library/presetTemplates")
    >()),
    fetchPresetTemplateFile: vi.fn(),
}));

const project = (over: Partial<Project>): Project =>
    ({ id: "p", cm_number: null, name: "", ...over }) as unknown as Project;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPresetTemplateFile).mockResolvedValue(
        new File(["x"], "t.docx"),
    );
    vi.mocked(uploadProjectDocument).mockResolvedValue({} as never);
});
afterEach(() => vi.clearAllMocks());

describe("findOrCreateSampleMatter", () => {
    it("creates one project with the SAMPLE number and imports the templates", async () => {
        vi.mocked(listProjects).mockResolvedValue([]);
        vi.mocked(createProject).mockResolvedValue(
            project({ id: "sample-1", cm_number: SAMPLE_MATTER_NUMBER }),
        );

        const { project: created, created: wasCreated } =
            await findOrCreateSampleMatter(undefined);

        expect(wasCreated).toBe(true);
        expect(created.id).toBe("sample-1");
        expect(createProject).toHaveBeenCalledExactlyOnceWith(
            SAMPLE_MATTER_NAME,
            SAMPLE_MATTER_NUMBER,
            undefined,
            undefined,
        );
        expect(uploadProjectDocument).toHaveBeenCalledTimes(
            SAMPLE_MATTER_TEMPLATE_IDS.length,
        );
        for (const call of vi.mocked(uploadProjectDocument).mock.calls) {
            expect(call[0]).toBe("sample-1");
        }
    });

    it("opens the existing sample matter and creates nothing", async () => {
        vi.mocked(listProjects).mockResolvedValue([
            project({ id: "other", cm_number: "2026-001" }),
            project({ id: "sample-1", cm_number: SAMPLE_MATTER_NUMBER }),
        ]);

        const { project: opened, created } =
            await findOrCreateSampleMatter("personal");

        expect(created).toBe(false);
        expect(opened.id).toBe("sample-1");
        expect(createProject).not.toHaveBeenCalled();
        expect(uploadProjectDocument).not.toHaveBeenCalled();
    });

    it("creates the sample matter under the active organization", async () => {
        vi.mocked(listProjects).mockResolvedValue([]);
        vi.mocked(createProject).mockResolvedValue(
            project({ id: "sample-org", cm_number: SAMPLE_MATTER_NUMBER }),
        );

        await findOrCreateSampleMatter("org-1");

        expect(createProject).toHaveBeenCalledExactlyOnceWith(
            SAMPLE_MATTER_NAME,
            SAMPLE_MATTER_NUMBER,
            undefined,
            "org-1",
        );
    });
});

describe("useSampleMatter", () => {
    it("opens the sample matter and navigates to it", async () => {
        vi.mocked(listProjects).mockResolvedValue([
            project({ id: "sample-1", cm_number: SAMPLE_MATTER_NUMBER }),
        ]);
        const onOpened = vi.fn();
        const { result } = renderHook(() => useSampleMatter(onOpened));

        act(() => result.current.openSampleMatter());

        await waitFor(() =>
            expect(push).toHaveBeenCalledWith("/projects/sample-1"),
        );
        expect(onOpened).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(result.current.pending).toBe(false));
    });

    it("sends one request for a double click", async () => {
        let release: (projects: Project[]) => void = () => {};
        vi.mocked(listProjects).mockReturnValue(
            new Promise<Project[]>((resolve) => {
                release = resolve;
            }),
        );
        const { result } = renderHook(() => useSampleMatter());

        act(() => {
            result.current.openSampleMatter();
            result.current.openSampleMatter();
        });

        expect(listProjects).toHaveBeenCalledTimes(1);
        expect(result.current.pending).toBe(true);

        await act(async () => {
            release([project({ id: "sample-1", cm_number: SAMPLE_MATTER_NUMBER })]);
        });
        expect(listProjects).toHaveBeenCalledTimes(1);
    });
});
