import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelectedModel, useSelectedReasoning } from "./useSelectedModel";
import {
    canonicalModelId,
    routerSelections as selectionsFromProfile,
} from "@/shared/lib/modelCatalog";
import type { ApiKeyState } from "../lib/mikeApi";

const keys: ApiKeyState = {
    claude: { configured: true, source: "user" },
    gemini: { configured: false, source: null },
    openai: { configured: true, source: "user" },
    mistral: { configured: false, source: null },
    openrouter: { configured: true, source: "user" },
    vercel: { configured: false, source: null },
    "opencode-go": { configured: false, source: null },
    bedrock: { configured: true, source: "user" },
    azure: { configured: false, source: null },
    "azure-foundry": { configured: false, source: null },
    vertex: { configured: true, source: "user" },
    xai: { configured: false, source: null },
    custom: { configured: false, source: null },
    courtlistener: { configured: false, source: null },
    brave: { configured: false, source: null },
    tavily: { configured: false, source: null },
    deepseek: { configured: false, source: null },
};

const routerSelections = selectionsFromProfile({
    openRouterModels: ["openai/gpt-5.4"],
});

const PROVIDERS: (keyof ApiKeyState)[] = [
    "claude",
    "gemini",
    "openai",
    "mistral",
    "openrouter",
    "vercel",
    "opencode-go",
    "bedrock",
    "azure",
    "azure-foundry",
    "vertex",
    "xai",
    "custom",
    "courtlistener",
    "brave",
    "tavily",
    "deepseek",
];

/** An ApiKeyState with every provider off, then the named ones configured. */
function keysWith(
    configured: Partial<Record<keyof ApiKeyState, ApiKeyState[keyof ApiKeyState]["source"]>>,
): ApiKeyState {
    const state = {} as ApiKeyState;
    for (const provider of PROVIDERS) {
        const source = configured[provider];
        state[provider] = source
            ? { configured: true, source }
            : { configured: false, source: null };
    }
    return state;
}

describe("useSelectedModel", () => {
    it("has no invented default when neither saved source is usable", () => {
        const { result } = renderHook(() => useSelectedModel());
        expect(result.current[0]).toBe("");
    });

    it("uses the saved chat model before the shared last-selected model", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "claude-fable-5-1",
                lastSelectedModel: "gpt-6-luna",
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("falls back to last-selected when the chat model has no current key", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "gemini-3.8-flash",
                lastSelectedModel: "gpt-6-luna",
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("gpt-6-luna");
    });

    it("restores a saved Bedrock model only while it is in the saved list", () => {
        const bedrockModel = "bedrock/us.anthropic.claude-opus-5-5";
        const selected = (bedrockModels: string[]) =>
            renderHook(() =>
                useSelectedModel({
                    chatModel: bedrockModel,
                    lastSelectedModel: "gpt-6-luna",
                    routerSelections: { ...routerSelections, bedrock: bedrockModels },
                    apiKeys: keys,
                }),
            ).result.current[0];

        expect(selected(["us.anthropic.claude-opus-5-5"])).toBe(bedrockModel);
        expect(selected([])).toBe("gpt-6-luna");
    });

    it("keeps an explicit selection in component state only", () => {
        const { result } = renderHook(() => useSelectedModel());

        act(() => result.current[1]("claude-fable-5-1"));

        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("accepts a deployment-configured model id", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "local-qwen",
                configuredModelIds: ["local-qwen"],
                apiKeys: keys,
            }),
        );

        expect(result.current[0]).toBe("local-qwen");
        act(() => result.current[1]("local-qwen"));
        expect(result.current[0]).toBe("local-qwen");
    });

    it("keeps a deployment override even when its id is in the legacy mapping", () => {
        const { result } = renderHook(() => useSelectedModel({
            chatModel: "gpt-5.4",
            configuredModelIds: ["gpt-5.4"],
            apiKeys: keys,
        }));
        expect(result.current[0]).toBe("gpt-5.4");
        act(() => result.current[1]("gpt-5.4"));
        expect(result.current[0]).toBe("gpt-5.4");
    });

    it("uses a chat router model while it remains in the saved list", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "openrouter/openai/gpt-5.4",
                lastSelectedModel: "gpt-6-luna",
                routerSelections,
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("openrouter/openai/gpt-5.4");
    });

    it("falls back when the chat router model is no longer saved", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                chatModel: "openrouter/pricy/frontier",
                lastSelectedModel: "gpt-6-luna",
                routerSelections,
                apiKeys: keys,
            }),
        );
        expect(result.current[0]).toBe("gpt-6-luna");
    });

    it("does not flash the profile model while an existing chat loads", () => {
        const { result, rerender } = renderHook(
            ({ chatModel }: { chatModel: string | null | undefined }) =>
                useSelectedModel({
                    selectionKey: "chat-1",
                    chatModel,
                    lastSelectedModel: "gpt-6-luna",
                    apiKeys: keys,
                }),
            {
                initialProps: {
                    chatModel: undefined as string | null | undefined,
                },
            },
        );

        expect(result.current[0]).toBe("");
        rerender({ chatModel: "claude-fable-5-1" });
        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("defaults to the first model the user's own keys can run", () => {
        const { result } = renderHook(() =>
            useSelectedModel({ apiKeys: keysWith({ claude: "user" }) }),
        );
        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("prefers the user's own key over the organization's for the default", () => {
        // Claude on the org's key sorts before OpenAI in the catalog, but the
        // user's own key wins the tier, so the default is the first OpenAI model.
        const { result } = renderHook(() =>
            useSelectedModel({
                apiKeys: keysWith({ claude: "org", openai: "user" }),
            }),
        );
        expect(result.current[0]).toBe("gpt-6-astra");
    });

    it("falls back to the organization's key when the user has none", () => {
        const { result } = renderHook(() =>
            useSelectedModel({ apiKeys: keysWith({ claude: "org" }) }),
        );
        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("uses a deployment environment key before a configured model id", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                apiKeys: keysWith({ claude: "env" }),
                configuredModelIds: ["local-qwen"],
            }),
        );
        expect(result.current[0]).toBe("claude-fable-5-1");
    });

    it("defaults to a deployment-configured model when no keys are usable", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                apiKeys: keysWith({}),
                configuredModelIds: ["local-qwen"],
            }),
        );
        expect(result.current[0]).toBe("local-qwen");
    });

    it("offers no default when nothing is runnable, so the set-up prompt shows", () => {
        const { result } = renderHook(() =>
            useSelectedModel({ apiKeys: keysWith({}) }),
        );
        expect(result.current[0]).toBe("");
    });

    it("defaults to a saved router model when only a router key is configured", () => {
        const { result } = renderHook(() =>
            useSelectedModel({
                apiKeys: keysWith({ openrouter: "user" }),
                routerSelections,
            }),
        );
        expect(result.current[0]).toBe("openrouter/openai/gpt-5.4");
    });

    it("seeds a configured deployment model even while key state is unknown", () => {
        // apiKeys undefined means personal key state has not loaded; no catalog
        // model is guessed from it. A configured deployment model still seeds
        // the default, because the backend already lists it as runnable.
        const { result } = renderHook(() =>
            useSelectedModel({ configuredModelIds: ["local-qwen"] }),
        );
        expect(result.current[0]).toBe("local-qwen");
    });
});

describe("useSelectedReasoning", () => {
    it("loads the chat level before the profile fallback", () => {
        const { result } = renderHook(() =>
            useSelectedReasoning({
                selectionKey: "chat-1",
                chatReasoningLevel: "low",
                lastSelectedReasoningLevel: "xhigh",
            }),
        );
        expect(result.current[0]).toBe("low");
    });

    it("defaults a new user to high", () => {
        const { result } = renderHook(() => useSelectedReasoning({}));
        expect(result.current[0]).toBe("high");
    });

    it("uses the profile reasoning level on surfaces without chat settings", () => {
        const { result } = renderHook(() =>
            useSelectedReasoning({ lastSelectedReasoningLevel: "low" }),
        );
        expect(result.current[0]).toBe("low");
    });
});

describe("canonicalModelId", () => {
    it("maps only known legacy ids", () => {
        expect(canonicalModelId("gemini-3.1-flash-lite-preview")).toBe(
            "gemini-3.5-flash-lite",
        );
        expect(canonicalModelId("gpt-5.4-lite")).toBe("gpt-6-luna");
        expect(canonicalModelId("claude-fable-5-1")).toBe("claude-fable-5-1");
    });
});
