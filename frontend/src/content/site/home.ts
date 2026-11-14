// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the public home page, kept apart from the component so counsel
// can review the words in one place. W20's content lint reads this file.
// Everything here describes what the product does; it makes no claim about
// accuracy or time saved, because none has been measured, and it names no
// customer, because none may be named.

import { brand } from "@/shared/brand.generated";
import { SITE_CHROME_COPY } from "./chrome";

/** One step of "How it works": what the reader does, then what they see. */
export interface HomeStep {
    readonly title: string;
    readonly body: string;
}

/** One fact, with the page that backs it up where there is one. */
export interface HomeFact {
    readonly title: string;
    readonly body: string;
    /** Where the fact can be checked: a page of this site. */
    readonly link?: { readonly href: string; readonly label: string };
}

export const HOME_COPY = {
    /** The page's one h1. */
    headline: "Review, draft and negotiate with sources you can check.",
    lede: `${brand.productName} reads the documents you give it and answers with the passages it relied on. Every quote is matched against the source text and labelled with what was found. Every proposed edit waits for a lawyer’s decision.`,
    /** The one action of the page; the two links after it step down from it. */
    primaryAction: SITE_CHROME_COPY.createAccount,
    secondaryAction: SITE_CHROME_COPY.signIn,
    docsAction: "Read the documentation",
    /** Under the action: what a visitor gets by taking it, and nothing more. */
    actionNote:
        "A new account can open a sample matter made of public contract templates, so you can look around before adding a document of your own.",
    /**
     * Says what the illustration beside it shows. The illustration itself is
     * hidden from assistive technology, so this sentence carries its meaning
     * for every reader.
     */
    vignetteCaption:
        "An example with invented text: two answers, each beside the passage it quotes and a label saying whether those words were found in the document. One quote was found and one was not. A found quote shows that the words are in the document, not that the answer is right.",
    stepsHeading: "How it works",
    steps: [
        {
            title: "Add documents and ask",
            body: "Upload contracts or open a matter. Ask a question, run a workflow, or start a tabular review that puts the same questions to many documents.",
        },
        {
            title: "Read each answer beside its source",
            body: "Open a quote to see the passage in the document. Its label says whether the quoted words were found there.",
        },
        {
            title: "Decide, and keep the evidence",
            body: `Accept or reject each edit ${brand.assistantName} proposes, and accept, override or escalate each playbook finding. The Excel export of a review keeps every quote and its status.`,
        },
    ] as readonly HomeStep[],
    factsHeading: "What to know before you start",
    facts: [
        {
            title: "What the labels mean",
            body: "Found, partly found, not found, or no readable text: a label says whether the quoted words are in the document. No label says that an answer is right, so a lawyer still reads it against the source.",
            link: {
                href: "/docs/tabular-review-and-quote-status",
                label: "Read what each status means",
            },
        },
        {
            title: "Who decides",
            body: `${brand.assistantName} drafts and proposes. A lawyer decides, and each decision on a finding is recorded with a name and a time. Actions that leave the firm, such as sending an email, wait for approval by default.`,
        },
        {
            title: "Where your documents go",
            body: "Text you ask about is sent to the model providers this deployment is configured with, which the security page lists. The service does not train models on your content, and AI can be switched off for a single matter.",
            link: { href: "/security", label: "Read the security page" },
        },
        {
            title: "Source code you can read",
            body: "The complete source code of the running service is public under the GNU Affero General Public License, so what these pages say can be checked against the code, and you can run it yourself.",
            link: { href: "/source", label: "Find the source code" },
        },
        {
            title: "Where it works",
            body: "In the browser, and inside Microsoft Word through a task-pane add-in, where proposed edits arrive as tracked changes you review in the document itself.",
        },
        {
            title: "What it costs",
            body: "Plans are published on the pricing page as this deployment configures them. Nothing is charged through this site.",
            link: { href: "/pricing", label: "See the pricing page" },
        },
    ] as readonly HomeFact[],
    limitsHeading: "What it is not",
    limitsBody: `${brand.productName} is a tool for legal professionals and the people they supervise. It does not practise law, does not give legal advice and does not replace a lawyer’s judgement. Models can be wrong, out of date or unsupported by your documents, so read every answer against the source before relying on it.`,
    disclaimer: SITE_CHROME_COPY.disclaimer,
} as const;
