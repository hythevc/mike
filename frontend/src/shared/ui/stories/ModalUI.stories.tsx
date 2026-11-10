import { useState } from "react";
import { ModalUI } from "@/shared/ui/ModalUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";

const meta = { title: "Shared UI / Modal" };
export default meta;

export const Interactive = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <PillButtonUI tone="black" onClick={() => setOpen(true)}>
                Open modal
            </PillButtonUI>
            <ModalUI
                open={open}
                onClose={() => setOpen(false)}
                title="Add document"
                description="The title names the dialog and settles in on open."
                size="md"
                footerStatus={
                    <span className="text-xs text-fg-muted">Optional</span>
                }
                cancelAction={
                    <PillButtonUI tone="white" onClick={() => setOpen(false)}>
                        Cancel
                    </PillButtonUI>
                }
                primaryAction={
                    <PillButtonUI tone="blue" onClick={() => setOpen(false)}>
                        Add
                    </PillButtonUI>
                }
            >
                <div className="py-6 text-sm text-fg-subtle">
                    Short content keeps a natural height. Focus trapping, Escape
                    and backdrop dismissal all work.
                </div>
            </ModalUI>
        </>
    );
};

// A breadcrumbed dialog takes no title: the trail is the visible heading and
// the last crumb is the accessible name.
export const Breadcrumbs = () => {
    const [open, setOpen] = useState(true);
    return (
        <ModalUI
            open={open}
            onClose={() => setOpen(false)}
            breadcrumbs={["Matter", "Documents", "Add document"]}
            size="md"
        >
            <div className="py-6 text-sm text-fg-subtle">
                The last crumb, “Add document”, names the dialog.
            </div>
        </ModalUI>
    );
};

// Long content: the dialog grows to the viewport, then its body scrolls while
// the header and footer stay put.
export const TallContent = () => {
    const [open, setOpen] = useState(true);
    return (
        <ModalUI
            open={open}
            onClose={() => setOpen(false)}
            title="Long list"
            size="md"
            primaryAction={<PillButtonUI tone="blue">Done</PillButtonUI>}
        >
            <ul className="space-y-2 py-4 text-sm text-fg-subtle">
                {Array.from({ length: 40 }, (_, index) => (
                    <li key={index}>Document {index + 1}</li>
                ))}
            </ul>
        </ModalUI>
    );
};
