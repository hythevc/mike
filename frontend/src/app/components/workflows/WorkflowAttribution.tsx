// SPDX-License-Identifier: AGPL-3.0-only
//
// The read-only credit a catalog workflow carries: its licence, the author it
// was adapted from, a link to the source at the revision in use, a link to
// the change log, and the mandatory "Credits and licence" panel with the
// attribution line and the NOTICE text. Rendered in the add-on preview, on a
// workflow's detail page and on the open-source notices page, so the credit
// reads the same wherever it appears. No component here is interactive beyond
// the links, and every value wraps rather than truncating.

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import {
  ATTRIBUTION_TEXT,
  catalogChangesUrl,
  catalogSourceUrl,
  catalogStatusNotice,
  licenseLabel,
  licenseUrl,
  type WorkflowAttributionInfo,
} from "./workflowStatusLabels";

function AttributionField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-gray-400">{label}</div>
      <div className="mt-0.5 text-xs text-gray-800 [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

/** A link that opens the source or licence in a new tab, with a clear name. */
function ExternalTextLink({
  href,
  children,
  "aria-label": ariaLabel,
}: {
  href: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 font-medium text-blue-600 underline-offset-2 transition-colors hover:text-blue-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
    >
      <span className="[overflow-wrap:anywhere]">{children}</span>
      <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
    </a>
  );
}

function LicenceValue({ info }: { info: WorkflowAttributionInfo }) {
  const label = licenseLabel(info.license, info.licenseEvidence);
  const url = licenseUrl(info.license);
  if (!url) return <span className="text-gray-500">{label}</span>;
  return (
    <ExternalTextLink href={url} aria-label={`${label} licence text`}>
      {label}
    </ExternalTextLink>
  );
}

/**
 * The Licence, Adapted from, Source and Changes rows. Each row is omitted
 * when the catalog recorded nothing for it, except the licence, which always
 * shows (as "Licence not recorded" when unknown) so the absence is explicit.
 */
export function WorkflowAttributionFields({
  info,
}: {
  info: WorkflowAttributionInfo;
}) {
  const sourceUrl = catalogSourceUrl(info.provenance, info.commit);
  const changesUrl = catalogChangesUrl(info.provenance, info.commit);
  return (
    <div className="flex flex-col gap-3">
      <AttributionField label={ATTRIBUTION_TEXT.licence}>
        <LicenceValue info={info} />
      </AttributionField>
      {(info.attribution || info.adaptedFromTitle) && (
        <AttributionField label={ATTRIBUTION_TEXT.adaptedFrom}>
          {info.attribution ? <span>{info.attribution}</span> : null}
          {info.adaptedFromTitle ? (
            <span className={info.attribution ? "text-gray-500" : undefined}>
              {info.attribution ? " — " : ""}
              {info.adaptedFromTitle}
            </span>
          ) : null}
        </AttributionField>
      )}
      {sourceUrl && (
        <AttributionField label={ATTRIBUTION_TEXT.source}>
          <ExternalTextLink href={sourceUrl}>
            {ATTRIBUTION_TEXT.viewSource}
          </ExternalTextLink>
        </AttributionField>
      )}
      {changesUrl && (
        <AttributionField label={ATTRIBUTION_TEXT.changes}>
          <ExternalTextLink href={changesUrl}>
            {ATTRIBUTION_TEXT.viewChanges}
          </ExternalTextLink>
        </AttributionField>
      )}
    </div>
  );
}

/**
 * The "Credits and licence" panel: the attribution line and, when the source
 * shipped one, its NOTICE text verbatim. Mandatory for tabular add-ons, whose
 * preview otherwise shows only columns.
 */
export function WorkflowCreditsAndLicencePanel({
  info,
}: {
  info: WorkflowAttributionInfo;
}) {
  return (
    <section
      aria-label={ATTRIBUTION_TEXT.creditsHeading}
      className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} flex flex-col gap-3 rounded-xl p-4`}
    >
      <h3 className="text-xs font-semibold text-gray-900">
        {ATTRIBUTION_TEXT.creditsHeading}
      </h3>
      <WorkflowAttributionFields info={info} />
      {info.noticeMd?.trim() ? (
        <div>
          <div className="text-[11px] font-medium text-gray-400">
            {ATTRIBUTION_TEXT.notice}
          </div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/50 p-2 font-mono text-[11px] leading-5 text-gray-700">
            {info.noticeMd.trim()}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The read-only credit block on a workflow's detail page and on an imported
 * copy: the credit fields, the catalog status in plain words ("Update
 * available" or "Withdrawn"), the "Modified by your organisation" line once
 * the copy is edited, and the NOTICE text.
 */
export function WorkflowCreditBlock({
  info,
  className,
}: {
  info: WorkflowAttributionInfo;
  className?: string;
}) {
  const statusNotice = catalogStatusNotice(info.status);
  return (
    <section
      aria-label={ATTRIBUTION_TEXT.creditsHeading}
      className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} flex flex-col gap-3 rounded-xl p-4 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xs font-semibold text-gray-900">
          {ATTRIBUTION_TEXT.creditsHeading}
        </h3>
        {statusNotice ? (
          <span className="text-[11px] font-medium text-gray-500">
            {statusNotice}
          </span>
        ) : null}
      </div>
      <WorkflowAttributionFields info={info} />
      {info.modificationNotice ? (
        <p className="text-[11px] text-gray-500">{info.modificationNotice}</p>
      ) : null}
      {info.noticeMd?.trim() ? (
        <div>
          <div className="text-[11px] font-medium text-gray-400">
            {ATTRIBUTION_TEXT.notice}
          </div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/50 p-2 font-mono text-[11px] leading-5 text-gray-700">
            {info.noticeMd.trim()}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
