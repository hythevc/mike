// SPDX-License-Identifier: AGPL-3.0-only
import { Kbd } from "@/app/components/ui/kbd";

const meta = { title: "UI / Kbd" };
export default meta;

export const Keys = () => (
    <div className="flex max-w-md flex-col gap-4 p-4 text-sm text-fg">
        <section className="flex items-center gap-3">
            <span>Open the command menu</span>
            <Kbd keys={["mod", "K"]} />
        </section>
        <section className="flex items-center gap-3">
            <span>Newest actionable notification</span>
            <Kbd keys={["F8"]} />
        </section>
        <section className="flex items-center gap-3">
            <span>Close</span>
            <Kbd keys={["escape"]} />
        </section>
        <section className="flex items-center gap-3">
            <span>Extend a selection</span>
            <Kbd keys={["shift", "Click"]} />
        </section>
        <p className="text-xs text-fg-muted">
            The modifier follows the platform: ⌘ on Apple devices, Ctrl
            elsewhere. Parts are joined with non-breaking spaces so a chord
            never wraps.
        </p>
    </div>
);
