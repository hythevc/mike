// SPDX-License-Identifier: AGPL-3.0-only
import { HeadingUI, type HeadingUISize } from "@/shared/ui/HeadingUI";

const meta = { title: "Shared UI / Heading" };
export default meta;

const SIZES: { size: HeadingUISize; note: string }[] = [
    { size: "settings", note: "Settings-area title" },
    { size: "display", note: "Empty states and display headings" },
    { size: "page", note: "Page titles (beside controls)" },
    { size: "section", note: "A section within a page" },
    { size: "label", note: "A small group or field label" },
];

function Frame({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-full max-w-[36rem] space-y-5 bg-app-surface p-6 text-fg">
            {children}
        </div>
    );
}

export const Scale = () => (
    <Frame>
        {SIZES.map(({ size, note }) => (
            <div key={size} className="space-y-1">
                <HeadingUI size={size}>The quick brown fox</HeadingUI>
                <p className="text-xs text-fg-muted">
                    size=&quot;{size}&quot; — {note}
                </p>
            </div>
        ))}
    </Frame>
);

export const DangerSection = () => (
    <Frame>
        <HeadingUI size="section" tone="danger">
            Delete account
        </HeadingUI>
        <p className="text-sm text-fg-muted">
            The danger tone uses the semantic danger role, not a raw red.
        </p>
    </Frame>
);
