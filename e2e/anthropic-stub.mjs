/** Deterministic provider boundary for full-stack E2E; never calls a live model. */
import http from "node:http";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const textOf = (content) => typeof content === "string"
    ? content : (content ?? []).filter(block => block.type === "text").map(block => block.text).join("\n");

// The extracted document body sits in the tool result's final untrusted block.
// Echoing the instructions that precede it would feed their <CITATIONS> example
// into the app's citation parser and hide the rest of the answer.
function sourceFromToolResult(result) {
    if (result.is_error || !textOf(result.content).trim()) {
        throw new Error("Document read failed");
    }
    const toolText = textOf(result.content);
    return (
        [...toolText.matchAll(/<untrusted-content\b[^>]*>\n([\s\S]*?)\n<\/untrusted-content\b[^>]*>/g)].at(-1)?.[1] ??
        toolText
    );
}

// The first non-empty line of the given 1-based page in "[Page N]"-marked text.
function firstLineOfPage(source, pageNumber) {
    const after = source.split(`[Page ${pageNumber}]\n`)[1] ?? "";
    const body = after.split(/\n\n\[Page \d+\]/)[0] ?? after;
    return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

// A handful of scripts, not a model emulator. Unknown chat prompts fail rather
// than returning a plausible answer that could conceal a dropped user message.
function responseContent(body) {
    if (!body.stream) return [{ type: "text", text: "E2E chat" }];
    const prompt = [...body.messages].reverse()
        .filter(message => message.role === "user")
        .map(message => textOf(message.content)).find(Boolean) ?? "";
    const echo = prompt.match(/Reply with exactly: ([^\n]+)/);
    if (echo) return [{ type: "text", text: echo[1].trim() }];

    const systemText = textOf(body.system);
    // Documents-only turns carry the documents-only block and are offered no
    // CourtListener or web-search tool. The scripted answer is the fixed
    // "not in these documents" sentence (W25), so the app can render it and the
    // server can classify the turn as not-found.
    const documentsOnly = systemText.includes("DOCUMENTS-ONLY ANSWER SCOPE");
    if (documentsOnly && prompt.includes("Is there an arbitration clause?")) {
        if (body.tools?.some((tool) => tool.name?.startsWith("courtlistener") || tool.name === "web_search")) {
            throw new Error("Documents-only turn was offered a research or web tool");
        }
        return [{ type: "text", text: "Not in these documents." }];
    }

    // The wrong-page script cites a quote that is really on page 2 to page 1,
    // so the server's page check moves the citation to the page it found (W25).
    const wrongPage = prompt.includes("Quote the second-page clause.");
    const readFirstLine = prompt.includes("Read test.pdf and quote its first line.");
    if (!wrongPage && !readFirstLine) {
        throw new Error("Unexpected chat prompt in E2E provider fixture");
    }

    const result = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
        .find(block => block.type === "tool_result" && block.tool_use_id === "toolu_e2e_read");
    if (result) {
        const source = sourceFromToolResult(result);
        if (wrongPage) {
            const quote = firstLineOfPage(source, 2);
            if (!quote) throw new Error("Two-page fixture is missing its second page");
            const docLabel = systemText.match(/^- (doc-\d+):/m)?.[1] ?? "doc-0";
            const citations = JSON.stringify([
                { ref: 1, doc_id: docLabel, quotes: [{ page: 1, quote }] },
            ]);
            return [{ type: "text", text: `The clause is quoted below.[1]\n\n<CITATIONS>\n${citations}\n</CITATIONS>` }];
        }
        // Echo only what the real tool returned. The PDF's expected text lives
        // in the browser assertion; it is deliberately not supplied here.
        return [{ type: "text", text: `Document tool result:\n\n\`\`\`text\n${source}\n\`\`\`` }];
    }
    const filename = readFirstLine ? "test\\.pdf" : "two-page\\.pdf";
    const document = systemText.match(
        new RegExp(`^- (doc-\\d+): (?:<untrusted-content[^>]*>\\s*)?${filename}(?:\\s|<|$)`, "m"),
    );
    if (!document || !body.tools?.some(tool => tool.name === "read_document")) {
        throw new Error("Uploaded PDF or read_document missing from provider request");
    }
    return [{ type: "tool_use", id: "toolu_e2e_read", name: "read_document", input: { doc_id: document[1] } }];
}

export function createAnthropicStubServer() {
    return http.createServer(async (req, res) => {
        if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200).end("ok");
            return;
        }
        if (req.method !== "POST" || req.url !== "/v1/messages") {
            res.writeHead(404).end();
            return;
        }
        let body;
        try {
            let raw = "";
            for await (const chunk of req) raw += chunk;
            body = JSON.parse(raw);
        } catch {
            res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({
                type: "error", error: { type: "invalid_request_error", message: "Invalid JSON" },
            }));
            return;
        }
        let content;
        try {
            if (!body?.model || !Array.isArray(body.messages) || !body.messages.length) {
                throw new Error("Provider request requires model and messages");
            }
            content = responseContent(body);
        } catch (error) {
            console.error(error.message);
            res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({
                type: "error", error: { type: "invalid_request_error", message: error.message },
            }));
            return;
        }
        const stopReason = content[0].type === "tool_use" ? "tool_use" : "end_turn";
        const message = {
            id: "msg_e2e_fixture",
            type: "message",
            role: "assistant",
            model: body.model,
            content,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 },
        };
        // Title generation uses a non-streaming completion; chat uses SSE.
        if (!body.stream) {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(message));
            return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        event("message_start", { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
        const block = content[0];
        if (block.type === "tool_use") {
            event("content_block_start", { index: 0, content_block: { ...block, input: {} } });
            event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
        } else {
            event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
            for (const text of block.text.match(/.{1,64}/gs)) {
                if (res.destroyed) return;
                event("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
                await setTimeout(5);
            }
        }
        event("content_block_stop", { index: 0 });
        event("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
        event("message_stop", {});
        res.end();
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    createAnthropicStubServer().listen(4141, "127.0.0.1", () => {
        console.log("E2E model fixture ready on http://127.0.0.1:4141");
    });
}
