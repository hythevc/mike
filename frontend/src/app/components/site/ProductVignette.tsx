// SPDX-License-Identifier: AGPL-3.0-only
import { TabularQuoteMarker } from "@/app/components/tabular/TabularQuoteMarker";
import { VIGNETTE_PLACEHOLDERS } from "@/content/site/placeholders";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { TextSlabUI } from "@/shared/ui/TextSlabUI";

/**
 * The home page's one illustration: two answers from a review, each with the
 * passage it quotes and the marker the quote check gives it, one found and
 * one not. It is drawn with the product's own card, quote slab and
 * quote-status marker, so it shows the real vocabulary, and with invented
 * text from content/site/placeholders.ts, so it shows nobody's document.
 *
 * It is a picture, not content: `aria-hidden` keeps it out of the
 * accessibility tree and `inert` keeps anything inside it out of the tab
 * order, away from the pointer and out of text search. The sentence beside
 * it (HOME_COPY's vignetteCaption) says what it shows, for every reader.
 * Static on purpose: no script, no animation, nothing that waits for the
 * page to scroll.
 */
export function ProductVignette() {
    const { label, matterName, documentName, answers } = VIGNETTE_PLACEHOLDERS;
    return (
        <div data-slot="product-vignette" aria-hidden="true" inert>
            <GlassCardUI>
                <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-fg-muted">
                        <span>{matterName}</span>
                        <span>{label}</span>
                    </div>
                    <ul className="mt-3 divide-y divide-border">
                        {answers.map((item) => (
                            <li key={item.question} className="space-y-2 py-4 first:pt-0 last:pb-0">
                                <p className="text-xs font-medium text-fg-muted">
                                    {item.question}
                                </p>
                                <p className="text-sm leading-6 text-fg">{item.answer}</p>
                                <TextSlabUI>
                                    <p className="font-serif text-sm leading-6 text-fg-subtle">
                                        &ldquo;{item.quote}&rdquo;
                                    </p>
                                    <p className="mt-1 text-xs text-fg-muted">{documentName}</p>
                                </TextSlabUI>
                                <TabularQuoteMarker
                                    kind={item.found ? "found" : "not_found"}
                                    className="text-xs"
                                />
                            </li>
                        ))}
                    </ul>
                </div>
            </GlassCardUI>
        </div>
    );
}
