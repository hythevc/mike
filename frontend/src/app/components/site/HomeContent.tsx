// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { pillButtonUIClassName } from "@/shared/ui/PillButtonUI.styles";
import { HOME_COPY } from "@/content/site/home";

const textLinkClassName =
    "rounded-sm text-sm font-medium text-fg underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const sectionClassName = "mx-auto w-full max-w-5xl px-4 sm:px-6";

/**
 * The public home page's content. Every word comes from content/site/home.ts
 * so counsel reviews the copy in one place; this file only lays it out.
 */
export function HomeContent() {
    return (
        <main className="flex-1 pb-16">
            <section className={`${sectionClassName} pt-16 pb-12`}>
                <h1
                    className="max-w-3xl text-4xl font-medium tracking-tight text-fg sm:text-5xl"
                    style={{ fontFamily: "var(--brand-display-face)" }}
                >
                    {HOME_COPY.headline}
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-fg-subtle">
                    {HOME_COPY.lede}
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Link
                        href="/signup"
                        className={pillButtonUIClassName({ tone: "black", size: "normal" })}
                    >
                        {HOME_COPY.primaryAction}
                    </Link>
                    <Link
                        href="/login"
                        className={pillButtonUIClassName({ tone: "white", size: "normal" })}
                    >
                        {HOME_COPY.secondaryAction}
                    </Link>
                    <Link href="/docs" className={textLinkClassName}>
                        {HOME_COPY.docsAction}
                    </Link>
                </div>
            </section>

            <section aria-labelledby="home-facts" className={`${sectionClassName} pb-12`}>
                <h2 id="home-facts" className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                    {HOME_COPY.factsHeading}
                </h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                    {HOME_COPY.facts.map((fact) => (
                        <li key={fact.title} className="flex">
                            <GlassCardUI>
                                <div className="flex h-full flex-col p-5">
                                    <h3 className="text-base font-semibold text-fg">
                                        {fact.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-fg-subtle">
                                        {fact.body}
                                    </p>
                                </div>
                            </GlassCardUI>
                        </li>
                    ))}
                </ul>
            </section>

            <section aria-labelledby="home-works" className={`${sectionClassName} pb-12`}>
                <h2 id="home-works" className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                    {HOME_COPY.worksHeading}
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-fg-subtle">
                    {HOME_COPY.worksBody}
                </p>
            </section>

            <section aria-labelledby="home-limits" className={sectionClassName}>
                <h2 id="home-limits" className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                    {HOME_COPY.limitsHeading}
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-fg-subtle">
                    {HOME_COPY.limitsBody}
                </p>
                <p className="mt-3 text-sm text-fg-muted">{HOME_COPY.disclaimer}</p>
            </section>
        </main>
    );
}
