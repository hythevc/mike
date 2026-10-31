"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
    ONBOARDING_START_PATH,
    forgetPostOnboardingDestination,
    postOnboardingDestination,
    rememberPostOnboardingDestination,
} from "@/app/lib/authRedirects";
import { isPublicRoute } from "@/app/lib/publicRoutes";

export function OnboardingGate({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const { profile, loading } = useUserProfile();
    const isOnboardingRoute = pathname.startsWith("/onboarding");
    // Public pages (see publicRoutes.ts) look the same signed in or out, so
    // unfinished onboarding is no reason to send anyone away from them.
    const isPublic = isPublicRoute(pathname);
    // Credential-recovery pages must stay reachable even when onboarding is
    // incomplete: a recovery link logs the user in, and bouncing them to
    // onboarding here would discard the recovery session before they can set
    // a password (they'd stay locked out of their account forever).
    const isAuthTransitionRoute =
        pathname === "/login" ||
        pathname === "/login/sso" ||
        pathname === "/signup" ||
        pathname === "/signup/check-email" ||
        pathname === "/auth/callback" ||
        pathname === "/forgot-password" ||
        pathname === "/reset-password" ||
        pathname === "/verify-mfa";
    const needsOnboarding = profile?.onboardingComplete === false;
    const userId = user?.id ?? null;

    useEffect(() => {
        if (!userId || loading || !profile || isPublic) return;

        if (needsOnboarding && !isOnboardingRoute && !isAuthTransitionRoute) {
            // The page they asked for is where finishing onboarding returns.
            rememberPostOnboardingDestination(
                userId,
                `${pathname}${window.location.search}`,
            );
            router.replace(ONBOARDING_START_PATH);
            return;
        }
        if (!needsOnboarding && isOnboardingRoute) {
            // The same destination the last onboarding step navigates to, so
            // the two redirects agree instead of racing.
            router.replace(postOnboardingDestination(userId));
            return;
        }
        if (!needsOnboarding && !isAuthTransitionRoute) {
            // Arrived: a later visit to onboarding must not reuse the link.
            forgetPostOnboardingDestination();
        }
    }, [
        isOnboardingRoute,
        isAuthTransitionRoute,
        isPublic,
        loading,
        needsOnboarding,
        pathname,
        profile,
        router,
        userId,
    ]);

    if (!user || isPublic) return <>{children}</>;
    if (loading || !profile) return <FullScreenLoader />;
    if (needsOnboarding && !isOnboardingRoute && !isAuthTransitionRoute) {
        return <FullScreenLoader />;
    }
    if (!needsOnboarding && isOnboardingRoute) return <FullScreenLoader />;

    return <>{children}</>;
}
