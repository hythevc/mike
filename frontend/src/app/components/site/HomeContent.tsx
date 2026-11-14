// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import Link from "next/link";
import { HOME_COPY } from "@/content/site/home";
import { cn } from "@/app/lib/utils";
import { ProductVignette } from "./ProductVignette";
import {
    SITE_DISPLAY_STYLE,
    SITE_FOCUS_CLASS,
    SITE_PRIMARY_ACTION_SLOT,
    SITE_SECTION_HEADING_CLASS,
    SITE_STANDALONE_LINK_CLASS,
    SITE_TEXT_LINK_CLASS,
    sitePrimaryActionClassName,
} from "./siteStyles";

const containerClassName = "mx-auto w-full max-w-5xl px-4 sm:px-6";

// One five-column grid from `lg` up. The hero puts its text on three columns
// and the illustration on two; the sections below put their heading on two
// and their content on three. Every edge on the page sits on the same grid
// lines, and the headings read down the left as an index of the page. Below
// `lg` everything is one column.
const gridClassName = "lg:grid lg:grid-cols-5 lg:gap-12";

/**
 * A section below the hero: a plain heading beside its content, under a
 * rule that lines up with the text, not with the page's gutter.
 */
function HomeSection({
    id,
    heading,
    children,
}: {
    id: string;
    heading: string;
    children: ReactNode;
}) {
    return (
        <section aria-labelledby={id} className={containerClassName}>
            <div className={cn("border-t border-border py-10 sm:py-12", gridClassName)}>
                <h2
                    id={id}
                    className={cn(SITE_SECTION_HEADING_CLASS, "lg:col-span-2")}
                    style={SITE_DISPLAY_STYLE}
                >
                    {heading}
                </h2>
                <div className="mt-6 lg:col-span-3 lg:mt-0">{children}</div>
            </div>
        </section>
    );
}

/**
 * The public home page's content. Every word comes from content/site/home.ts
 * so counsel reviews the copy in one place; this file only lays it out.
 *
 * One focal point: the headline, its lede and the one filled action, with
 * sign-in and the documentation stepping down as links. The illustration and
 * the sentence that says what it shows sit beside them. Below, plain headings
 * over a numbered list of steps and a short list of facts, each fact next to
 * the page that backs it up. Nothing on the page moves, and nothing waits for
 * the reader to scroll.
 */
export function HomeContent() {
    return (
        <main className="flex-1 pb-16">
            <section
                className={cn(
                    containerClassName,
                    gridClassName,
                    "pt-12 pb-12 sm:pt-16 sm:pb-16 lg:items-start",
                )}
            >
                <div data-slot="home-hero" className="lg:col-span-3">
                    <h1
                        className="text-4xl font-medium tracking-tight text-balance text-fg sm:text-5xl"
                        style={SITE_DISPLAY_STYLE}
                    >
                        {HOME_COPY.headline}
                    </h1>
                    <p className="mt-6 max-w-2xl text-lg leading-8 text-fg-subtle">
                        {HOME_COPY.lede}
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-1">
                        <Link
                            href="/signup"
                            data-slot={SITE_PRIMARY_ACTION_SLOT}
                            className={sitePrimaryActionClassName()}
                        >
                            {HOME_COPY.primaryAction}
                        </Link>
                        <Link href="/login" className={SITE_STANDALONE_LINK_CLASS}>
                            {HOME_COPY.secondaryAction}
                        </Link>
                        <Link
                            href="/docs"
                            className={cn(
                                "inline-flex min-h-11 items-center rounded-sm text-sm text-fg-subtle underline underline-offset-4 hover:no-underline",
                                SITE_FOCUS_CLASS,
                            )}
                        >
                            {HOME_COPY.docsAction}
                        </Link>
                    </div>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">
                        {HOME_COPY.actionNote}
                    </p>
                </div>
                <figure className="mt-12 lg:col-span-2 lg:mt-2">
                    <ProductVignette />
                    <figcaption
                        data-slot="product-vignette-caption"
                        className="mt-3 text-sm leading-6 text-fg-subtle"
                    >
                        {HOME_COPY.vignetteCaption}
                    </figcaption>
                </figure>
            </section>

            <HomeSection id="home-steps" heading={HOME_COPY.stepsHeading}>
                <ol className="list-decimal space-y-6 pl-5 marker:font-medium marker:text-fg-muted">
                    {HOME_COPY.steps.map((step) => (
                        <li key={step.title} className="pl-2">
                            <h3 className="text-base font-medium text-fg">{step.title}</h3>
                            <p className="mt-1 max-w-prose text-sm leading-6 text-fg-subtle">
                                {step.body}
                            </p>
                        </li>
                    ))}
                </ol>
            </HomeSection>

            <HomeSection id="home-facts" heading={HOME_COPY.factsHeading}>
                <dl className="divide-y divide-border">
                    {HOME_COPY.facts.map((fact) => (
                        <div key={fact.title} className="py-5 first:pt-0 last:pb-0">
                            <dt className="text-base font-medium text-fg">{fact.title}</dt>
                            <dd className="mt-1 max-w-prose text-sm leading-6 text-fg-subtle">
                                <p>{fact.body}</p>
                                {fact.link ? (
                                    <p className="mt-2">
                                        <Link
                                            href={fact.link.href}
                                            className={SITE_TEXT_LINK_CLASS}
                                        >
                                            {fact.link.label}
                                        </Link>
                                    </p>
                                ) : null}
                            </dd>
                        </div>
                    ))}
                </dl>
            </HomeSection>

            <HomeSection id="home-limits" heading={HOME_COPY.limitsHeading}>
                <p className="max-w-prose text-base leading-7 text-fg-subtle">
                    {HOME_COPY.limitsBody}
                </p>
                <p className="mt-3 text-sm text-fg-muted">{HOME_COPY.disclaimer}</p>
            </HomeSection>
        </main>
    );
}
