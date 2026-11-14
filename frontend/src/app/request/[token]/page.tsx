// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { AuthFooter } from "@/app/components/auth/AuthFooter";
import { PublicRequestForm } from "@/app/components/intake/PublicRequestForm";

// A tokenized link is not for search engines, whichever organization it
// belongs to.
export const metadata: Metadata = {
    title: "Request form",
    robots: { index: false, follow: false },
};

interface PageProps {
    params: Promise<{ token: string }>;
}

/**
 * The public request form, reached by its link. /request/ is a public route
 * prefix (publicRoutes.ts), so the onboarding and MFA gates render it signed
 * out or in; the page itself never depends on a session. The footer carries
 * the Source, Terms and Privacy links every visitor is owed.
 */
export default async function RequestFormPage({ params }: PageProps) {
    const { token } = await params;
    return (
        <div className="flex min-h-dvh flex-col bg-app-background text-fg">
            <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
                <PublicRequestForm token={token} />
            </main>
            <AuthFooter />
        </div>
    );
}
