// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { AuthFooter } from "@/app/components/auth/AuthFooter";

/**
 * Wraps the sign-up page so it carries the source, terms and privacy footer
 * without the page itself changing. The page centres its card in a full-height
 * area, so the footer is pinned to the bottom of the viewport beneath it.
 */
export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      {children}
      <AuthFooter className="absolute inset-x-0 bottom-0" />
    </div>
  );
}
