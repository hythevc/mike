"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import { authInputUIClassName } from "@/shared/ui/AuthStylesUI";
import { InputUI } from "@/shared/ui/InputUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { recordLegalAcceptances, updateUserProfile } from "@/app/lib/mikeApi";
import { postOnboardingDestination } from "@/app/lib/authRedirects";
import { FieldLabel } from "@/app/components/ui/form-field";
import { describeError } from "@/app/lib/userFacingError";
import {
    legalDocumentForBrandKey,
    type LegalDocument,
} from "@/content/legal/registry";
import type { BrandLegalDocumentKey } from "@/shared/brand.generated";

/** The profile fields this onboarding step reads. */
interface OnboardingProfile {
    displayName: string | null;
    organisation: string | null;
    onboardingVersion: number | null;
    legalAcceptanceRequired: string[];
}

export default function OnboardingProfilePage() {
    const router = useRouter();
    const { user, authLoading } = useAuth();
    const { profile, loading } = useUserProfile();

    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, router, user]);

    if (authLoading || loading || !user || !profile) {
        return <FullScreenLoader />;
    }

    return (
        <ProfileDetailsForm key={user.id} userId={user.id} profile={profile} />
    );
}

/** The legal documents still to accept, resolved to their registry entries. */
function requiredLegalDocuments(profile: OnboardingProfile): LegalDocument[] {
    return profile.legalAcceptanceRequired
        .map((key) => legalDocumentForBrandKey(key as BrandLegalDocumentKey))
        .filter((doc): doc is LegalDocument => doc !== undefined);
}

function ProfileDetailsForm({
    userId,
    profile,
}: {
    userId: string;
    profile: OnboardingProfile;
}) {
    const router = useRouter();
    const { reloadProfile } = useUserProfile();
    const [name, setName] = useState(profile.displayName ?? "");
    const [organisation, setOrganisation] = useState(
        profile.organisation ?? "",
    );
    const [accepted, setAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const legalDocuments = requiredLegalDocuments(profile);
    const needsAcceptance = legalDocuments.length > 0;
    // Once the personalisation steps are done (a returning user after a
    // version change, or an account created before this step existed), only
    // the acceptance is left to collect.
    const acceptanceOnly = profile.onboardingVersion !== null;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;
        if (needsAcceptance && !accepted) {
            setError("Please confirm you accept the documents to continue.");
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            if (!acceptanceOnly) {
                await updateUserProfile({
                    displayName: name.trim() || null,
                    organisation: organisation.trim() || null,
                });
            }
            if (needsAcceptance) {
                await recordLegalAcceptances(
                    legalDocuments.map((doc) => ({
                        document: doc.brandKey,
                        version: doc.version,
                    })),
                );
            }
            await reloadProfile();
            router.push(
                acceptanceOnly
                    ? postOnboardingDestination(userId)
                    : "/onboarding/practice",
            );
        } catch (submitError) {
            setError(
                describeError(submitError, {
                    action: acceptanceOnly
                        ? "record your acceptance"
                        : "save your details",
                    fallback: "Something went wrong. Try again.",
                }).message,
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <OnboardingShell
            step={acceptanceOnly ? "Final step" : "Step 1 of 4"}
            title={acceptanceOnly ? "Review and accept" : "Tell us about you"}
            description={
                acceptanceOnly
                    ? "Please review and accept the current documents to continue."
                    : "Add the details we should use across the app."
            }
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {!acceptanceOnly && (
                    <>
                        <div>
                            <FieldLabel htmlFor="name">Name</FieldLabel>
                            <InputUI
                                id="name"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                maxLength={200}
                                autoComplete="name"
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>
                        <div>
                            <FieldLabel htmlFor="organisation">
                                Organisation
                            </FieldLabel>
                            <InputUI
                                id="organisation"
                                value={organisation}
                                onChange={(event) =>
                                    setOrganisation(event.target.value)
                                }
                                maxLength={200}
                                autoComplete="organization"
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>
                    </>
                )}

                {needsAcceptance && (
                    <label className="flex items-start gap-3 rounded-lg border border-current/15 p-3 text-sm leading-6">
                        <input
                            type="checkbox"
                            checked={accepted}
                            onChange={(event) =>
                                setAccepted(event.target.checked)
                            }
                            className="mt-1 size-4 shrink-0 accent-current focus-visible:outline-2 focus-visible:outline-offset-2"
                        />
                        <span>
                            I have read and accept the{" "}
                            {legalDocuments.map((doc, index) => (
                                <span key={doc.slug}>
                                    {index > 0 &&
                                        (index === legalDocuments.length - 1
                                            ? " and "
                                            : ", ")}
                                    <a
                                        href={doc.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline underline-offset-2 hover:no-underline"
                                    >
                                        {doc.title}
                                    </a>
                                </span>
                            ))}
                            .
                        </span>
                    </label>
                )}

                {error && (
                    <div
                        className="rounded bg-red-50 p-3 text-sm text-red-600"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <div className="pt-2">
                    <PillButtonUI
                        type="submit"
                        tone="black"
                        size="normal"
                        disabled={submitting}
                        className="w-full"
                    >
                        {submitting
                            ? "Saving..."
                            : acceptanceOnly
                              ? "Accept and continue"
                              : "Continue"}
                    </PillButtonUI>
                </div>
            </form>
        </OnboardingShell>
    );
}
