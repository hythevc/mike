// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { cn } from "@/app/lib/utils";
import { getBuildInfo } from "@/app/lib/buildInfo";

/**
 * A small footer for the signed-out pages (login, sign-up and, later, the
 * public request form). It carries the three links a visitor is owed before
 * they sign in: the source of the running build (AGPL-3.0 section 13), and
 * the terms and privacy notices. "Source" points at the repository at the
 * exact running commit, so the offer is honoured even for someone who never
 * signs in.
 */
export function AuthFooter({ className }: { className?: string }) {
  const build = getBuildInfo();
  const linkClassName =
    "rounded-sm underline-offset-2 transition-colors hover:text-gray-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <footer
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-4 text-center text-xs text-gray-500",
        className,
      )}
    >
      <a
        href={build.sourceTreeUrl}
        target="_blank"
        rel="noreferrer"
        className={linkClassName}
      >
        Source
      </a>
      <Link href={brand.legalDocuments.terms.url} className={linkClassName}>
        Terms
      </Link>
      <Link href={brand.legalDocuments.privacy.url} className={linkClassName}>
        Privacy
      </Link>
    </footer>
  );
}
