import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsDescription, SettingsLabel } from "./SettingsText";

describe("settings text", () => {
    it("applies the fixed shared label style", () => {
        render(<SettingsLabel>Setting name</SettingsLabel>);

        // TextUI subtle + medium: 14px secondary text in the fg colour role.
        expect(screen.getByText("Setting name")).toHaveClass(
            "text-sm",
            "font-medium",
            "text-fg-subtle",
        );
    });

    it("applies the fixed shared description style", () => {
        render(<SettingsDescription>Setting details</SettingsDescription>);

        // TextUI muted: 14px muted text in the fg colour role.
        expect(screen.getByText("Setting details")).toHaveClass(
            "text-sm",
            "text-fg-muted",
        );
    });
});
