// SPDX-License-Identifier: AGPL-3.0-only
//
// What one streamed call (streamAiSdk) used, model call by model call.
//
// The meter is a model middleware, so it sees every provider request a call
// makes, including the ones whose end the stream's consumer never reads: a
// step that pauses for an approval or for the user's input (the pause aborts
// the stream before the step's finish-step part), and a step the user stops.
//
// A provider reports a model call's tokens in that call's own `finish` part,
// before any tool runs, and the meter takes them from there. A model call
// that ends without a report after the provider had started streaming its
// answer (the user stopped it, the provider dropped it, a deadline cut it
// off), and one whose provider reports no token counts at all, is estimated
// instead: about four characters a token over the text it was sent and the
// text it streamed back, and the ledger row says the tokens are estimated. A
// model call that ends before any of its answer arrived (refused, failed, or
// stopped while the provider was still reading) is not counted.

import type { LanguageModelMiddleware } from "ai" with {
    "resolution-mode": "import",
};
import type { ModelUsage } from "../usage";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type CallParams = Parameters<WrapStream>[0]["params"];
type StreamPart =
    Awaited<ReturnType<WrapStream>>["stream"] extends ReadableStream<infer Part>
        ? Part
        : never;

/** Characters per token in an estimate: the usual rule of thumb for prose. */
export const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

/** What a call used, and whether any of it is an estimate. */
export type MeteredUsage = { usage: ModelUsage; estimated: boolean };

/** Tokens for `characters` of text, by the rule of thumb above. */
export function estimatedTokens(characters: number): number {
    return characters > 0
        ? Math.ceil(characters / ESTIMATED_CHARACTERS_PER_TOKEN)
        : 0;
}

/** Message and part fields that label the prompt rather than carry its text. */
const LABEL_KEYS = new Set(["role", "type", "mediaType", "providerOptions"]);

/**
 * Characters of text in a prompt: every string in it except the labels on
 * its messages and parts, and except the content of attached files, which
 * no character count describes.
 */
export function promptCharacters(value: unknown, depth = 0): number {
    if (typeof value === "string") return value.length;
    if (depth > 16 || value === null || typeof value !== "object") return 0;
    if (ArrayBuffer.isView(value) || value instanceof URL) return 0;
    if (Array.isArray(value)) {
        let total = 0;
        for (const item of value) total += promptCharacters(item, depth + 1);
        return total;
    }
    const record = value as Record<string, unknown>;
    let total = 0;
    for (const [key, item] of Object.entries(record)) {
        if (LABEL_KEYS.has(key) || (key === "data" && record.type === "file")) {
            continue;
        }
        total += promptCharacters(item, depth + 1);
    }
    return total;
}

/** The characters a model call was sent: its prompt and its tool definitions. */
function sentCharacters(params: CallParams): number {
    let tools = 0;
    try {
        tools = JSON.stringify(params.tools ?? []).length;
    } catch {
        // A definition that does not serialize adds nothing to the estimate.
    }
    return promptCharacters(params.prompt) + tools;
}

type ReportedUsage = {
    inputTokens?: { total?: number; cacheRead?: number };
    outputTokens?: { total?: number };
};

/** A provider's `finish` usage as the ledger counts it, or null when it reports none. */
export function reportedUsage(
    usage: ReportedUsage | undefined,
): ModelUsage | null {
    const input = usage?.inputTokens?.total;
    const output = usage?.outputTokens?.total;
    if (input === undefined && output === undefined) return null;
    return {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
        cachedTokens: usage?.inputTokens?.cacheRead ?? 0,
    };
}

type ModelCall = {
    params: CallParams;
    /** Characters of answer streamed so far: text, reasoning and tool input. */
    output: number;
    /** Tool calls whose input arrived as deltas, so it is not counted twice. */
    streamedToolInputs: Set<string>;
};

/**
 * A meter for one streamed call. Wrap the model with `middleware`, and call
 * `close` once the call has ended, however it ended: it settles every model
 * call still open and returns the call's total, or null when no model call
 * used anything.
 */
export function createUsageMeter(): {
    middleware: LanguageModelMiddleware;
    close(): MeteredUsage | null;
} {
    const total: ModelUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let counted = false;
    let estimated = false;
    let closed = false;
    const open = new Set<ModelCall>();

    const add = (usage: ModelUsage, isEstimate: boolean) => {
        total.inputTokens += usage.inputTokens;
        total.outputTokens += usage.outputTokens;
        total.cachedTokens += usage.cachedTokens;
        counted = true;
        if (isEstimate) estimated = true;
    };
    const estimate = (call: ModelCall) =>
        add(
            {
                inputTokens: estimatedTokens(sentCharacters(call.params)),
                outputTokens: estimatedTokens(call.output),
                cachedTokens: 0,
            },
            true,
        );

    const observe = (call: ModelCall, part: StreamPart) => {
        if (closed || !open.has(call)) return;
        switch (part.type) {
            case "text-delta":
            case "reasoning-delta":
                call.output += part.delta.length;
                break;
            case "tool-input-delta":
                call.streamedToolInputs.add(part.id);
                call.output += part.delta.length;
                break;
            case "tool-call":
                if (!call.streamedToolInputs.has(part.toolCallId)) {
                    call.output += part.input.length;
                }
                break;
            case "finish": {
                open.delete(call);
                const usage = reportedUsage(part.usage);
                if (usage) add(usage, false);
                else estimate(call);
                break;
            }
        }
    };

    const middleware: LanguageModelMiddleware = {
        wrapStream: async ({ doStream, params }) => {
            if (closed) return doStream();
            const call: ModelCall = {
                params,
                output: 0,
                streamedToolInputs: new Set(),
            };
            open.add(call);
            let result: Awaited<ReturnType<typeof doStream>>;
            try {
                result = await doStream();
            } catch (error) {
                // Refused before any answer: nothing was used.
                open.delete(call);
                throw error;
            }
            return {
                ...result,
                stream: result.stream.pipeThrough(
                    new TransformStream<StreamPart, StreamPart>({
                        transform(part, controller) {
                            observe(call, part);
                            controller.enqueue(part);
                        },
                    }),
                ),
            };
        },
    };

    return {
        middleware,
        close() {
            if (!closed) {
                closed = true;
                // Cut off before the provider reported: estimated, when some
                // of the answer had arrived.
                for (const call of open) if (call.output > 0) estimate(call);
                open.clear();
            }
            return counted ? { usage: { ...total }, estimated } : null;
        },
    };
}
