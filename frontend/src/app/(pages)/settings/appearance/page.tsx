"use client";

import { brand } from "@/shared/brand.generated";
import { useState } from "react";
import { Check } from "lucide-react";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import type { ThemePreference } from "@/app/lib/theme";
import { cn } from "@/app/lib/utils";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { TextUI } from "@/shared/ui/TextUI";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "System",
    description: "Follow your device's appearance setting.",
  },
  { value: "light", label: "Light", description: "Always use the light theme." },
  { value: "dark", label: "Dark", description: "Always use the dark theme." },
];

export default function AppearancePage() {
  const { profile, updateTheme } = useUserProfile();
  const [saving, setSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  if (!profile) return null;

  const current = profile.theme;

  const chooseTheme = async (preference: ThemePreference) => {
    if (saving || preference === current) return;
    setSaving(true);
    setThemeError(null);
    try {
      await updateTheme(preference);
    } catch (error) {
      setThemeError(
        userFacingApiError(error, "Could not update the appearance setting."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <SettingsHeading id="appearance">Appearance</SettingsHeading>
      <GlassCardUI>
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <TextUI as="p" variant="subtle" weight="medium" id="appearance-theme">
              Theme
            </TextUI>
            <SettingsDescription>
              Choose how {brand.productName} looks, or follow your device.
            </SettingsDescription>
            {themeError && (
              <p role="alert" className="text-xs text-danger">
                {themeError}
              </p>
            )}
          </div>
          <div
            role="radiogroup"
            aria-labelledby="appearance-theme"
            className="flex flex-col gap-1.5"
          >
            {THEME_OPTIONS.map((option) => {
              const selected = current === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => void chooseTheme(option.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    selected
                      ? "bg-app-surface-active"
                      : "hover:bg-app-surface-hover",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-focus-ring" : "border-border-strong",
                    )}
                  >
                    {selected && (
                      <span className="h-2 w-2 rounded-full bg-focus-ring" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <TextUI as="span" variant="body" weight="medium" className="block">
                      {option.label}
                    </TextUI>
                    <TextUI as="span" variant="muted" className="block">
                      {option.description}
                    </TextUI>
                  </span>
                  {selected && (
                    <Check
                      aria-hidden="true"
                      className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-focus-ring"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCardUI>
    </section>
  );
}
