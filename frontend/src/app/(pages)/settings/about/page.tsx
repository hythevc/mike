// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { getBuildInfo, repositoryFileUrl } from "@/app/lib/buildInfo";

const linkClassName =
  "rounded-sm font-medium text-gray-900 underline underline-offset-2 transition-colors hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function AboutPage() {
  const build = getBuildInfo();

  return (
    <section className="space-y-3">
      <SettingsHeading id="about">About</SettingsHeading>

      <GlassCardUI>
        <div className="space-y-4">
          <div className="min-w-0 space-y-1">
            <SettingsLabel>Version</SettingsLabel>
            <SettingsDescription>
              <span className="tabular-nums">
                {build.version ?? "development build"}
              </span>
              {build.shortCommit ? (
                <>
                  {" · commit "}
                  <a
                    href={build.sourceTreeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={linkClassName}
                  >
                    <span className="font-mono tabular-nums">
                      {build.shortCommit}
                    </span>
                  </a>
                </>
              ) : null}
            </SettingsDescription>
          </div>

          <div className="min-w-0 space-y-1">
            <SettingsLabel>Source code</SettingsLabel>
            <SettingsDescription>
              {brand.productName} is licensed under the GNU Affero General Public
              License v3.0 only. You may read, run and modify the complete
              source of this exact version.
            </SettingsDescription>
            <p className="text-sm">
              <a
                href={build.sourceTreeUrl}
                target="_blank"
                rel="noreferrer"
                className={linkClassName}
              >
                View the source at this version
              </a>
            </p>
          </div>

          <div className="min-w-0 space-y-1">
            <SettingsLabel>Upstream project</SettingsLabel>
            <SettingsDescription>
              {brand.upstreamAttribution.notice}
            </SettingsDescription>
            <p className="text-sm">
              <a
                href={brand.upstreamAttribution.url}
                target="_blank"
                rel="noreferrer"
                className={linkClassName}
              >
                {brand.upstreamAttribution.projectName} source
              </a>
            </p>
          </div>

          <div className="min-w-0 space-y-1">
            <SettingsLabel>Licences and notices</SettingsLabel>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <li>
                <a
                  href={repositoryFileUrl(build, "LICENSE")}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClassName}
                >
                  Licence
                </a>
              </li>
              <li>
                <a
                  href={repositoryFileUrl(build, "CREDITS.md")}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClassName}
                >
                  Open-source credits
                </a>
              </li>
              <li>
                <a
                  href={repositoryFileUrl(build, "NOTICE.md")}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClassName}
                >
                  Notice
                </a>
              </li>
            </ul>
          </div>

          <SettingsDescription>
            The workflow catalogue and its credits, and a public summary of this
            build, are listed at{" "}
            <Link href="/source" className={linkClassName}>
              /source
            </Link>
            .
          </SettingsDescription>
        </div>
      </GlassCardUI>
    </section>
  );
}
