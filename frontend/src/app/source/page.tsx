// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { brand } from "@/shared/brand.generated";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { getBuildInfo, repositoryFileUrl } from "@/app/lib/buildInfo";

export const metadata: Metadata = {
  title: "Source code",
  description:
    "The complete corresponding source of this running build, offered under the GNU Affero General Public License v3.0 only.",
};

const linkClassName =
  "rounded-sm font-medium text-gray-900 underline underline-offset-2 transition-colors hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The public, unauthenticated source page (AGPL-3.0 section 13). It renders
 * from the build's own identity and the brand configuration, so it needs no
 * session and no backend call; a machine-readable version of the same offer is
 * served by the API at GET /source.
 */
export default function SourcePage() {
  const build = getBuildInfo();

  return (
    <main className="min-h-dvh bg-gray-50/80 px-6 py-16">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-medium text-gray-950">Source code</h1>
          <p className="text-sm text-gray-600">
            {brand.productName}
            {build.version ? (
              <>
                {" "}
                version{" "}
                <span className="tabular-nums">{build.version}</span>
              </>
            ) : null}
            {build.shortCommit ? (
              <>
                {", commit "}
                <span className="font-mono tabular-nums">
                  {build.shortCommit}
                </span>
              </>
            ) : null}
            . Licensed under the GNU Affero General Public License v3.0 only
            (AGPL-3.0-only).
          </p>
        </header>

        <GlassCardUI>
          <div className="space-y-5">
            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-900">
                Corresponding source
              </h2>
              <p className="text-sm text-gray-600">
                You may read, run and modify the complete source of this exact
                version.
              </p>
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
            </section>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-900">
                Upstream project
              </h2>
              <p className="text-sm text-gray-600">
                {brand.upstreamAttribution.notice}
              </p>
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
            </section>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-900">
                Licences and notices
              </h2>
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
                <li>
                  <a
                    href={repositoryFileUrl(build, "MODIFICATIONS.md")}
                    target="_blank"
                    rel="noreferrer"
                    className={linkClassName}
                  >
                    Modifications
                  </a>
                </li>
              </ul>
            </section>
          </div>
        </GlassCardUI>
      </div>
    </main>
  );
}
