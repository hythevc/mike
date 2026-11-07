// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export interface ContentPageProps {
    /** The page heading and document title. */
    title: string;
    /** The document body as Markdown, with its placeholders already filled. */
    markdown: string;
    /** A draft document shows a banner and is excluded from search engines. */
    status: "draft" | "in-effect";
    /** The version shown in the page's footer line. */
    version: string;
}

/**
 * Drop react-markdown's `node` prop before the rest is spread onto a DOM
 * element (the element does not accept it). Avoids naming an unused variable.
 */
function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
    const rest: Record<string, unknown> = { ...props };
    delete rest.node;
    return rest as Omit<T, "node">;
}

// The app does not load a typography plugin, so each element is styled here.
// Headings start at h2 — the page's single h1 is the document title above.
const MARKDOWN_COMPONENTS: Components = {
    h1: (props) => <h2 className="mt-8 mb-3 text-xl font-semibold" {...withoutNode(props)} />,
    h2: (props) => <h2 className="mt-8 mb-3 text-xl font-semibold" {...withoutNode(props)} />,
    h3: (props) => <h3 className="mt-6 mb-2 text-lg font-semibold" {...withoutNode(props)} />,
    p: (props) => <p className="mb-4 leading-7" {...withoutNode(props)} />,
    ul: (props) => (
        <ul className="mb-4 list-disc list-outside pl-6 space-y-1" {...withoutNode(props)} />
    ),
    ol: (props) => (
        <ol className="mb-4 list-decimal list-outside pl-6 space-y-1" {...withoutNode(props)} />
    ),
    li: (props) => <li className="leading-7" {...withoutNode(props)} />,
    strong: (props) => <strong className="font-semibold" {...withoutNode(props)} />,
    a: (props) => (
        <a
            className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
            {...withoutNode(props)}
        />
    ),
    blockquote: (props) => (
        <blockquote
            className="mb-6 border-l-4 border-current/30 pl-4 italic opacity-90"
            {...withoutNode(props)}
        />
    ),
    hr: (props) => <hr className="my-8 border-current/15" {...withoutNode(props)} />,
    table: (props) => (
        <div className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm" {...withoutNode(props)} />
        </div>
    ),
    th: (props) => (
        <th className="border border-current/20 px-3 py-2 font-semibold align-top" {...withoutNode(props)} />
    ),
    td: (props) => (
        <td className="border border-current/20 px-3 py-2 align-top" {...withoutNode(props)} />
    ),
};

/**
 * Renders a Markdown content page: the Terms, Privacy Notice and the other
 * legal documents, and (through the same component) other static pages. A
 * draft shows a plain banner saying it is not in effect; the page it is used
 * on sets `noindex` for drafts.
 */
export function ContentPage({
    title,
    markdown,
    status,
    version,
}: ContentPageProps) {
    const isDraft = status === "draft";
    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
            {isDraft && (
                <div
                    role="note"
                    className="mb-6 rounded-lg border border-amber-500/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                >
                    Draft, not in effect, pending counsel review.
                </div>
            )}
            <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">{title}</h1>
            <div className="text-base">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS}
                >
                    {markdown}
                </ReactMarkdown>
            </div>
            <p className="mt-10 border-t border-current/10 pt-4 text-sm opacity-70">
                Version {version} ·{" "}
                {isDraft ? "Draft, not in effect" : "In effect"}
            </p>
        </main>
    );
}
