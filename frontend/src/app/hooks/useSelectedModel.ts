"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReasoningLevel } from "../components/assistant/ModelToggle";
import {
    canonicalModelId,
    isAllowedModelId,
    isRouterModelSelected,
    MODELS,
    modelGroupToProvider,
    type ProviderKeyStates,
    ROUTER_SLUGS,
    type RouterSelections,
} from "@/shared/lib/modelCatalog";
import { isModelAvailable } from "../lib/modelAvailability";
import type { ApiKeyState } from "../lib/mikeApi";

export interface SelectedModelSources {
    selectionKey?: string | null;
    chatModel?: string | null;
    lastSelectedModel?: string | null;
    /**
     * Each router's saved Model Selections, or null while they are unknown
     * (a stored router selection is then left alone). Pass a stable object
     * (e.g. memoized on the profile): a new one re-resolves the selection.
     */
    routerSelections?: RouterSelections | null;
    /** Undefined means availability is unknown and must fail open. */
    apiKeys?: ApiKeyState;
    /** Authenticated deployment models returned by GET /models/configured. */
    configuredModelIds?: readonly string[];
}

function usableStoredModel(
    value: string | null | undefined,
    sources: SelectedModelSources,
): string | null {
    if (!value) return null;
    const canonical = sources.configuredModelIds?.includes(value)
        ? value
        : canonicalModelId(value);
    if (!isAllowedModelId(canonical, sources.configuredModelIds)) return null;

    if (sources.configuredModelIds?.includes(canonical)) return canonical;

    if (
        sources.routerSelections &&
        !isRouterModelSelected(canonical, sources.routerSelections)
    ) {
        return null;
    }
    if (sources.apiKeys && !isModelAvailable(canonical, sources.apiKeys)) {
        return null;
    }
    return canonical;
}

/**
 * The first model the user can run on a key from one source — "user" (their
 * own keys), "org" (the organization's) or "env" (the deployment's). Direct
 * catalog models are tried in catalog order, then each router's first saved
 * Model Selection. Returns null when that source has nothing usable, or when
 * key state is unknown (availability must fail open, so no default is guessed).
 */
function firstModelFromKeySource(
    sources: SelectedModelSources,
    source: "user" | "org" | "env",
): string | null {
    const keys: ProviderKeyStates | undefined = sources.apiKeys;
    if (!keys) return null;
    const runsOnSource = (provider: string): boolean => {
        const state = keys[provider];
        return (
            !!state?.configured &&
            state.enabled !== false &&
            state.source === source
        );
    };
    for (const model of MODELS) {
        if (runsOnSource(modelGroupToProvider(model.group))) return model.id;
    }
    const selections = sources.routerSelections;
    if (selections) {
        for (const slug of ROUTER_SLUGS) {
            if (!runsOnSource(slug)) continue;
            const first = selections[slug]?.[0];
            if (first) return `${slug}/${first}`;
        }
    }
    return null;
}

/**
 * The product default for a composer that has no usable saved selection: the
 * first model the user can run, preferring their own keys, then the
 * organization's, then the deployment's — its environment keys, then the
 * models the backend lists as configured for this user. Returns "" when
 * nothing is runnable, so the composer shows its set-up prompt rather than a
 * model it could not send to.
 */
function productDefaultModel(sources: SelectedModelSources): string {
    return (
        firstModelFromKeySource(sources, "user") ??
        firstModelFromKeySource(sources, "org") ??
        firstModelFromKeySource(sources, "env") ??
        sources.configuredModelIds?.[0] ??
        ""
    );
}

/**
 * Resolve chat model → profile last-selected model → a product default: the
 * first model the user can run (user keys, then org keys, then deployment
 * models), so the composer never opens on an empty picker when something is
 * runnable.
 */
export function useSelectedModel(
    sources: SelectedModelSources = {},
): [string, (id: string) => void] {
    const [model, setModelState] = useState("");
    const manuallySelected = useRef(false);
    const previousSelectionKey = useRef(sources.selectionKey);
    const configuredModelIds = sources.configuredModelIds;
    const selectionSources = useMemo<SelectedModelSources>(
        () => ({
            selectionKey: sources.selectionKey,
            chatModel: sources.chatModel,
            lastSelectedModel: sources.lastSelectedModel,
            routerSelections: sources.routerSelections ?? null,
            apiKeys: sources.apiKeys,
            configuredModelIds,
        }),
        [
            sources.selectionKey,
            sources.chatModel,
            sources.lastSelectedModel,
            sources.routerSelections,
            sources.apiKeys,
            configuredModelIds,
        ],
    );

    /* eslint-disable react-hooks/set-state-in-effect -- persisted profile/chat settings arrive asynchronously and initialize controlled composer state */
    useEffect(() => {
        if (previousSelectionKey.current !== selectionSources.selectionKey) {
            previousSelectionKey.current = selectionSources.selectionKey;
            manuallySelected.current = false;
        }
        if (manuallySelected.current) return;
        if (
            selectionSources.selectionKey &&
            selectionSources.chatModel === undefined
        ) {
            // Existing chat settings have not loaded yet. Do not flash the
            // profile fallback before the chat's own selection arrives.
            setModelState("");
            return;
        }
        const next =
            usableStoredModel(selectionSources.chatModel, selectionSources) ??
            usableStoredModel(
                selectionSources.lastSelectedModel,
                selectionSources,
            ) ??
            productDefaultModel(selectionSources);
        setModelState(next);
    }, [selectionSources]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const setModel = useCallback(
        (id: string) => {
            const canonical = configuredModelIds?.includes(id)
                ? id
                : canonicalModelId(id);
            const next = isAllowedModelId(canonical, configuredModelIds)
                ? canonical
                : "";
            manuallySelected.current = true;
            setModelState(next);
        },
        [configuredModelIds],
    );

    return [model, setModel];
}

export function useSelectedReasoning(sources: {
    selectionKey?: string | null;
    chatReasoningLevel?: ReasoningLevel | null;
    lastSelectedReasoningLevel?: ReasoningLevel | null;
}): [ReasoningLevel, (level: ReasoningLevel) => void] {
    const [level, setLevelState] = useState<ReasoningLevel>("high");
    const manuallySelected = useRef(false);
    const previousSelectionKey = useRef(sources.selectionKey);

    /* eslint-disable react-hooks/set-state-in-effect -- persisted profile/chat settings arrive asynchronously and initialize controlled composer state */
    useEffect(() => {
        if (previousSelectionKey.current !== sources.selectionKey) {
            previousSelectionKey.current = sources.selectionKey;
            manuallySelected.current = false;
        }
        if (manuallySelected.current) return;
        if (sources.selectionKey && sources.chatReasoningLevel === undefined) {
            return;
        }
        setLevelState(
            sources.chatReasoningLevel ??
                sources.lastSelectedReasoningLevel ??
                "high",
        );
    }, [
        sources.selectionKey,
        sources.chatReasoningLevel,
        sources.lastSelectedReasoningLevel,
    ]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const setLevel = useCallback((next: ReasoningLevel) => {
        manuallySelected.current = true;
        setLevelState(next);
    }, []);

    return [level, setLevel];
}
