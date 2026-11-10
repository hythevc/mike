// SPDX-License-Identifier: AGPL-3.0-only
import { TextUI, type TextUIVariant } from "@/shared/ui/TextUI";

const meta = { title: "Shared UI / Text" };
export default meta;

const VARIANTS: { variant: TextUIVariant; note: string }[] = [
    { variant: "body", note: "14px primary — prose and rows" },
    { variant: "chrome", note: "13px primary — the dense chrome base" },
    { variant: "subtle", note: "14px secondary — a field label" },
    { variant: "muted", note: "14px muted — a description or caption" },
    { variant: "badge", note: "11px muted — the floor, for a badge" },
];

function Frame({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-full max-w-[36rem] space-y-4 bg-app-surface p-6">
            {children}
        </div>
    );
}

export const Variants = () => (
    <Frame>
        {VARIANTS.map(({ variant, note }) => (
            <div key={variant} className="space-y-0.5">
                <TextUI variant={variant}>
                    Either party may terminate on thirty days’ notice.
                </TextUI>
                <TextUI variant="badge">
                    variant=&quot;{variant}&quot; — {note}
                </TextUI>
            </div>
        ))}
    </Frame>
);

export const LabelAndDescription = () => (
    <Frame>
        <TextUI variant="subtle" weight="medium">
            Theme
        </TextUI>
        <TextUI variant="muted">
            Follow the system setting, or choose light or dark.
        </TextUI>
    </Frame>
);

export const StatusTones = () => (
    <Frame>
        <TextUI tone="danger">Couldn’t save the document.</TextUI>
        <TextUI tone="success">Saved.</TextUI>
        <TextUI tone="warning">This matter restricts AI.</TextUI>
    </Frame>
);
