import type { ReactNode } from "react";
import { HeadingUI } from "@/shared/ui/HeadingUI";

export function SettingsHeading({
  children,
  id,
  tone = "default",
}: {
  children: ReactNode;
  id?: string;
  tone?: "default" | "danger";
}) {
  return (
    <HeadingUI
      as="h2"
      size="section"
      id={id}
      tone={tone}
      // Settings search scrolls a heading into view and focuses it; the
      // margin keeps it clear of the top edge and the ring reads as a mark,
      // not a control. The ring is the themed focus-ring token, not a raw
      // blue, so it stays the one system accent.
      className="scroll-mt-6 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
    >
      {children}
    </HeadingUI>
  );
}
