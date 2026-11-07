// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement } from "react";
import { Info } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The legal-information-not-legal-advice line shown under every finished AI
 * answer, in the web app and the Word add-in (W25). AI output is a draft for a
 * lawyer to decide on, so this never claims the answer is correct and asks the
 * reader to check each citation. It is a cross-target component: it must not
 * import anything from `frontend/src/app/`.
 */
export const ANSWER_DISCLAIMER_TEXT =
  "AI reading aid over your documents. Legal information, not legal advice. Check each citation before relying on it.";

export function AnswerDisclaimerUI({
  className,
}: {
  className?: string;
}): ReactElement {
  return (
    <p
      className={twMerge(
        clsx(
          "mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-500",
          className,
        ),
      )}
    >
      <Info aria-hidden="true" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
      <span>{ANSWER_DISCLAIMER_TEXT}</span>
    </p>
  );
}
