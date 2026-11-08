// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    fetchPresetTemplateFile,
    PRESET_TEMPLATES,
    type PresetTemplate,
} from "@/app/components/library/presetTemplates";
import {
    PERSONAL_WORKSPACE,
    useWorkspaceParam,
} from "@/app/contexts/WorkspaceContext";
import {
    createProject,
    listProjects,
    uploadProjectDocument,
} from "@/app/lib/mikeApi";
import type { Project } from "@/app/components/shared/types";
import { notifyError } from "@/app/lib/userFacingError";

/** The reserved client-matter number that marks the one shared sample matter. */
export const SAMPLE_MATTER_NUMBER = "SAMPLE";

/** Its name doubles as a label: this holds public templates, not client data. */
export const SAMPLE_MATTER_NAME =
    "Sample matter - public templates, not client data";

/**
 * A few unmodified public templates to open the sample matter with: General
 * Legal (CC0 1.0, public domain) and Common Paper (CC BY 4.0, whose own
 * attribution travels inside each unmodified document). Referenced by catalog
 * id so the upload carries the catalog's size and SHA-256 integrity check and
 * refuses anything altered.
 */
export const SAMPLE_MATTER_TEMPLATE_IDS: readonly string[] = [
    "General Legal/Mutual Non-Disclosure Agreement (NDA).docx",
    "Common Paper/Mutual NDA v1.0 - Cover Page and Standard Terms.docx",
    "General Legal/Master Services Agreement (MSA).docx",
];

/** The org id to create under, or undefined in a personal workspace. */
function workspaceOrgId(workspace: string | undefined): string | undefined {
    return workspace && workspace !== PERSONAL_WORKSPACE ? workspace : undefined;
}

async function importSampleTemplates(projectId: string): Promise<void> {
    for (const id of SAMPLE_MATTER_TEMPLATE_IDS) {
        const preset = PRESET_TEMPLATES.find(
            (candidate: PresetTemplate) => candidate.id === id,
        );
        if (!preset) continue;
        const file = await fetchPresetTemplateFile(preset);
        await uploadProjectDocument(projectId, file);
    }
}

/**
 * Find the existing sample matter in this workspace, or create it with the
 * reserved SAMPLE number and the public templates. A check for the number
 * first keeps one sample per workspace; two devices creating at the same
 * moment can still make two, which is harmless.
 */
export async function findOrCreateSampleMatter(
    workspace: string | undefined,
): Promise<{ project: Project; created: boolean }> {
    const existing = (await listProjects({ workspace })).find(
        (project) => project.cm_number === SAMPLE_MATTER_NUMBER,
    );
    if (existing) return { project: existing, created: false };
    const project = await createProject(
        SAMPLE_MATTER_NAME,
        SAMPLE_MATTER_NUMBER,
        undefined,
        workspaceOrgId(workspace),
    );
    await importSampleTemplates(project.id);
    return { project, created: true };
}

export interface SampleMatter {
    /** True while a create-or-open request is in flight. */
    pending: boolean;
    /** Open the sample matter, creating it (with templates) the first time. */
    openSampleMatter: () => void;
}

/**
 * Open the ready-made sample matter, building it from public templates the
 * first time. A request in flight is guarded so a double click sends one
 * request; the button should also disable on `pending`.
 */
export function useSampleMatter(
    onOpened?: (project: Project) => void,
): SampleMatter {
    const router = useRouter();
    const workspace = useWorkspaceParam();
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const onOpenedRef = useRef(onOpened);
    onOpenedRef.current = onOpened;
    // The latest opener, so a failure notice's Retry re-runs this same flow.
    const openRef = useRef<() => void>(() => {});

    const openSampleMatter = useCallback(() => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        void (async () => {
            try {
                const { project } = await findOrCreateSampleMatter(workspace);
                onOpenedRef.current?.(project);
                router.push(`/projects/${project.id}`);
            } catch (error) {
                notifyError(error, {
                    operation: "sample_matter_open",
                    action: "open the sample matter",
                    onRetry: () => openRef.current(),
                });
            } finally {
                inFlight.current = false;
                setPending(false);
            }
        })();
    }, [router, workspace]);

    useEffect(() => {
        openRef.current = openSampleMatter;
    }, [openSampleMatter]);

    return { pending, openSampleMatter };
}
