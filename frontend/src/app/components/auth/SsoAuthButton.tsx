"use client";

import { Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { ONBOARDING_START_PATH } from "@/app/lib/authRedirects";

interface SsoAuthButtonProps {
    disabled?: boolean;
    /** Where single sign-on lands once signed in. */
    next?: string;
}

export function SsoAuthButton({
    disabled = false,
    next = ONBOARDING_START_PATH,
}: SsoAuthButtonProps) {
    const router = useRouter();
    const ssoPath =
        next === ONBOARDING_START_PATH
            ? "/login/sso"
            : `/login/sso?next=${encodeURIComponent(next)}`;

    return (
        <PillButtonUI
            type="button"
            tone="white"
            size="normal"
            className="w-full"
            disabled={disabled}
            onClick={() => router.push(ssoPath)}
        >
            <Globe aria-hidden="true" className="h-4 w-4" />
            Continue with SSO
        </PillButtonUI>
    );
}
