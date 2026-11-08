// SPDX-License-Identifier: AGPL-3.0-only
//
// Copy for the public home page, kept apart from the component so counsel
// can review the words in one place. W20's content lint reads this file.
// Everything here describes what the product does; it makes no claim about
// accuracy or time saved, because none has been measured.

import { brand } from "@/shared/brand.generated";
import { SITE_CHROME_COPY } from "./chrome";

export interface HomeFact {
    readonly title: string;
    readonly body: string;
}

export const HOME_COPY = {
    /** The page's one h1. */
    headline: "Review, draft and negotiate with sources you can check.",
    lede: `${brand.productName} reads the documents you give it and answers with the passages it relied on. Every quote is matched against the source text and labelled with what was found. Every proposed edit waits for a lawyer's decision.`,
    primaryAction: SITE_CHROME_COPY.createAccount,
    secondaryAction: SITE_CHROME_COPY.signIn,
    docsAction: "Read the documentation",
    factsHeading: "What you get",
    facts: [
        {
            title: "Quotes you can check",
            body: "Chat answers and tabular review cells quote the source. Each quote is matched against the document's text and labelled: found, partly found, not found, or no readable text. The labels say what was checked, not that an answer is right.",
        },
        {
            title: "The lawyer decides",
            body: `${brand.assistantName} proposes tracked changes, findings and drafts. You accept, override or escalate each one, and the decision is recorded with a name and a time. Actions that leave the firm, such as sending an email, wait for approval.`,
        },
        {
            title: "Your matters, on the record",
            body: "Switch AI off for a matter whose client has restricted it. See which documents the assistant read. Download a matter's AI usage with the model, the key it ran on and an estimated cost.",
        },
        {
            title: "Your data, your terms",
            body: "Your content is not used to train models. Export everything you have stored, or delete it, at any time. The complete source code is public under the GNU Affero General Public License, so you can inspect it or run it yourself.",
        },
    ] as readonly HomeFact[],
    worksHeading: "Where it works",
    worksBody:
        "In the browser, and inside Microsoft Word through the task-pane add-in, where proposed edits arrive as tracked changes you review in the document itself.",
    limitsHeading: "What it is not",
    limitsBody: `${brand.productName} is a tool for legal professionals and the people they supervise. It does not practise law, does not give legal advice and does not replace a lawyer's judgement. Models can be wrong, out of date or unsupported by your documents, so read every answer against the source before relying on it.`,
    disclaimer: SITE_CHROME_COPY.disclaimer,
} as const;
