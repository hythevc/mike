// SPDX-License-Identifier: AGPL-3.0-only
//
// The open-source notices page: every workflow in the active catalog with the
// author credited, the licence that governs it, a link to its source at the
// revision in use, and that revision. It sits beside the platform's own
// source offer and is the destination the "workflow applied" chip links to.

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkflowCatalogAttribution } from "@/app/components/shared/types";
import { listWorkflowAttributions } from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { WorkflowAttributionFields } from "./WorkflowAttribution";
import {
  ATTRIBUTION_TEXT,
  attributionInfoFromCatalogEntry,
  revisionLabel,
} from "./workflowStatusLabels";

type LoadState = "loading" | "error" | "ready";

function entryAuthor(entry: WorkflowCatalogAttribution): string | null {
  const names = entry.contributors
    .map((contributor) => contributor.name.trim())
    .filter(Boolean);
  if (names.length > 0) return names.join(", ");
  return entry.attribution?.trim() || null;
}

function AttributionEntry({ entry }: { entry: WorkflowCatalogAttribution }) {
  const author = entryAuthor(entry);
  const revision = revisionLabel(entry.version, entry.source_commit);
  const kind =
    entry.distribution === "default"
      ? ATTRIBUTION_TEXT.builtIn
      : ATTRIBUTION_TEXT.addOn;
  return (
    <li
      className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} flex flex-col gap-3 rounded-xl p-4`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">
          {entry.title}
        </h2>
        <span className="text-[11px] text-gray-400">
          {kind}
          {entry.pack_title ? ` · ${entry.pack_title}` : ""}
        </span>
      </div>
      {author ? (
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-gray-400">Author</div>
          <div className="mt-0.5 text-xs text-gray-800 [overflow-wrap:anywhere]">
            {author}
          </div>
        </div>
      ) : null}
      <WorkflowAttributionFields info={attributionInfoFromCatalogEntry(entry)} />
      {revision ? (
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-gray-400">
            {ATTRIBUTION_TEXT.revision}
          </div>
          <div className="mt-0.5 font-mono text-xs text-gray-700 [overflow-wrap:anywhere]">
            {revision}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function WorkflowAttributionsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [entries, setEntries] = useState<WorkflowCatalogAttribution[]>([]);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listWorkflowAttributions()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setState("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(userFacingApiError(cause, ATTRIBUTION_TEXT.noticesError));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Setting "loading" here (an event handler, not the effect) avoids a
  // synchronous setState inside the fetch effect.
  const retry = useCallback(() => {
    setState("loading");
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        shrink
        loading={state === "loading"}
        breadcrumbs={[
          { label: "Workflows", onClick: () => router.push("/workflows") },
          { label: "Open-source notices" },
        ]}
      />
      <h1 className="sr-only">{ATTRIBUTION_TEXT.noticesHeading}</h1>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {state === "loading" ? (
          <ul className="flex max-w-3xl flex-col gap-3" aria-hidden="true">
            {[1, 2, 3].map((index) => (
              <li
                key={index}
                className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} flex flex-col gap-3 rounded-xl p-4`}
              >
                <SkeletonLine className="h-4 w-48" />
                <SkeletonLine className="w-32" />
                <SkeletonLine className="w-40" />
              </li>
            ))}
          </ul>
        ) : state === "error" ? (
          <EmptyState
            tone="error"
            title="Couldn't load the notices"
            description={error || ATTRIBUTION_TEXT.noticesError}
            action={
              <PillButtonUI type="button" tone="black" size="sm" onClick={retry}>
                Try again
              </PillButtonUI>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title={ATTRIBUTION_TEXT.noticesHeading}
            description={ATTRIBUTION_TEXT.noticesEmpty}
          />
        ) : (
          <>
            <p className="mb-4 max-w-3xl text-xs text-gray-500">
              {ATTRIBUTION_TEXT.noticesIntro}
            </p>
            <ul className="flex max-w-3xl flex-col gap-3">
              {entries.map((entry) => (
                <AttributionEntry
                  key={`${entry.distribution}:${entry.workflow_key}`}
                  entry={entry}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
