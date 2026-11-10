import type { ReactNode } from "react";
import { TextUI } from "@/shared/ui/TextUI";

export function SettingsLabel({ children }: { children: ReactNode }) {
    return (
        <TextUI variant="subtle" weight="medium">
            {children}
        </TextUI>
    );
}

export function SettingsDescription({ children }: { children: ReactNode }) {
    return <TextUI variant="muted">{children}</TextUI>;
}
