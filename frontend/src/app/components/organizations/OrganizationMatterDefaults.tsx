// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMemo, useState } from "react";
import { JurisdictionMultiSelect } from "@/app/components/jurisdictions/JurisdictionMultiSelect";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsSelectRow,
  type SettingsSelectOption,
} from "@/app/components/settings/SettingsSelectRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { FieldLabel } from "@/app/components/ui/form-field";
import { useJurisdictionRegistry } from "@/app/hooks/useJurisdictionRegistry";
import { setOrgMatterDefaults, type Org } from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";

const LANGUAGE_NONE = "__none__";

type Defaults = { jurisdictions: string[]; language: string | null };

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((code, index) => code === b[index]);

/**
 * What an organization's new projects start with: default jurisdictions and
 * a default working language. For its owners and admins, who are the ones the
 * server lets set them; a project can change either afterwards, and projects
 * that already exist are left as they are.
 *
 * Both are edited as a draft and saved together, so one change to the
 * defaults is one request and one line in the audit log.
 */
export function OrganizationMatterDefaults({
  org,
  onSaved,
}: {
  org: Org;
  /** The organization with the saved defaults in place. */
  onSaved: (org: Org) => void;
}) {
  const { registry, error: registryError, retry } = useJurisdictionRegistry();
  const savedJurisdictions = useMemo(
    () => org.default_jurisdictions ?? [],
    [org.default_jurisdictions],
  );
  const savedLanguage = org.default_working_language ?? null;

  // The draft, and the saved state it was last brought in line with. When
  // what is saved changes (a save landing, or the organization being read
  // again), a field the admin has not touched follows it; one they have
  // changed keeps their change, so an edit made while a save is on its way
  // is not thrown away when the save lands.
  const savedKey = `${savedJurisdictions.join(",")}|${savedLanguage ?? ""}`;
  const [editing, setEditing] = useState<{
    savedKey: string;
    saved: Defaults;
    draft: Defaults;
  }>(() => {
    const saved = {
      jurisdictions: savedJurisdictions,
      language: savedLanguage,
    };
    return { savedKey, saved, draft: saved };
  });
  if (editing.savedKey !== savedKey) {
    const saved = {
      jurisdictions: savedJurisdictions,
      language: savedLanguage,
    };
    setEditing({
      savedKey,
      saved,
      draft: {
        jurisdictions: sameList(
          editing.draft.jurisdictions,
          editing.saved.jurisdictions,
        )
          ? saved.jurisdictions
          : editing.draft.jurisdictions,
        language:
          editing.draft.language === editing.saved.language
            ? saved.language
            : editing.draft.language,
      },
    });
  }
  const draft = editing.draft;
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | { error: string }
  >("idle");

  const jurisdictionsChanged = !sameList(
    draft.jurisdictions,
    savedJurisdictions,
  );
  const languageChanged = draft.language !== savedLanguage;
  const dirty = jurisdictionsChanged || languageChanged;
  const saving = status === "saving";

  const languageOptions = useMemo<SettingsSelectOption[]>(() => {
    const notSet: SettingsSelectOption = {
      value: LANGUAGE_NONE,
      label: "Not set",
      description: "New projects start with no working language.",
    };
    if (!registry) {
      // On its way: no options yet, and the row shows its placeholder.
      if (!registryError) return [];
      // Could not be read: the row says what is saved, by its tag, and
      // offers nothing else. It does not go on looking as if it is loading.
      return [
        draft.language
          ? {
              value: draft.language,
              label: draft.language,
              description: `New projects start with ${draft.language} as their working language.`,
            }
          : notSet,
      ];
    }
    const options: SettingsSelectOption[] = [
      notSet,
      ...registry.working_languages.map((language) => ({
        value: language.code,
        label: language.name,
        description: `New projects start with ${language.name} as their working language.`,
      })),
    ];
    // A saved language the list no longer offers is still shown, so the row
    // says what is stored instead of looking as if it never loaded.
    if (
      draft.language &&
      !options.some((option) => option.value === draft.language)
    )
      options.push({
        value: draft.language,
        label: draft.language,
        description: "This language is no longer offered. Choose another.",
      });
    return options;
  }, [registry, registryError, draft.language]);

  function change(next: Partial<Defaults>) {
    setEditing((current) => ({
      ...current,
      draft: { ...current.draft, ...next },
    }));
    // A change clears "Saved" or an error. It does not end a save that is
    // on its way: that still lands, and the newer change is kept for the
    // next one.
    setStatus((current) => (current === "saving" ? current : "idle"));
  }

  async function save() {
    if (!dirty || saving) return;
    setStatus("saving");
    try {
      const saved = await setOrgMatterDefaults(org.id, {
        ...(jurisdictionsChanged
          ? { default_jurisdictions: draft.jurisdictions }
          : {}),
        ...(languageChanged
          ? { default_working_language: draft.language }
          : {}),
      });
      onSaved({ ...org, ...saved });
      setStatus("saved");
    } catch (error) {
      setStatus({
        error: userFacingApiError(
          error,
          "The defaults could not be saved. Try again.",
        ),
      });
    }
  }

  const statusText =
    status === "saving"
      ? "Saving..."
      : status === "saved"
        ? "Saved"
        : typeof status === "object"
          ? status.error
          : "";

  return (
    <section aria-labelledby="org-matter-defaults" className="space-y-3">
      <SettingsHeading id="org-matter-defaults">
        New Project Defaults
      </SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="min-w-0">
            <FieldLabel htmlFor="org-default-jurisdictions">
              Default jurisdictions
            </FieldLabel>
            <JurisdictionMultiSelect
              id="org-default-jurisdictions"
              surface="settings"
              value={draft.jurisdictions}
              onChange={(jurisdictions) => change({ jurisdictions })}
              options={registry?.jurisdictions ?? []}
              max={registry?.max_jurisdictions ?? 10}
              disabled={saving}
              // Without the registry there are no names to choose from.
              readOnly={!registry}
              emptyText="No default jurisdictions. New projects start with none."
            />
            {registryError ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                The lists of jurisdictions and languages could not be loaded,
                so the defaults cannot be changed yet.{" "}
                <TextButtonUI
                  size="xs"
                  className="min-h-6 underline"
                  onClick={retry}
                >
                  Try again
                </TextButtonUI>
              </p>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsSelectRow
          id="org-default-working-language"
          label="Default working language"
          options={languageOptions}
          value={
            registry || registryError ? (draft.language ?? LANGUAGE_NONE) : null
          }
          onChange={(code) =>
            change({ language: code === LANGUAGE_NONE ? null : code })
          }
        />
        <SettingsRow>
          <div className="min-w-0 space-y-1">
            <SettingsDescription>
              New projects in this organization start with these. A project
              can change them, and existing projects stay as they are.
            </SettingsDescription>
            <p
              aria-live="polite"
              className={`min-h-4 text-xs ${
                typeof status === "object" ? "text-danger" : "text-fg-muted"
              }`}
            >
              {statusText}
            </p>
          </div>
          <PillButtonUI
            tone="black"
            size="sm"
            disabled={!dirty || !registry}
            loading={saving}
            onClick={() => void save()}
            className="w-full shrink-0 sm:w-auto"
          >
            Save defaults
          </PillButtonUI>
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}
