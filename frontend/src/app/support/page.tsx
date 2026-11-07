"use client";

import { useEffect } from "react";
import { BookOpen, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { brand } from "@/shared/brand.generated";

export default function SupportPage() {
    const router = useRouter();
    const { user, isAuthenticated, authLoading } = useAuth();

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push("/");
        }
    }, [authLoading, isAuthenticated, router]);

    const mailtoHref = `mailto:${brand.supportEmail}?subject=${encodeURIComponent(
        `${brand.productName} support`,
    )}`;

    return (
        <div className="w-full flex flex-col px-6 h-full">
            <div className="w-full max-w-2xl m-auto flex flex-col h-full">
                <div className="flex-shrink-0 pt-6 md:pt-10 pb-0">
                    <h1
                        className="text-4xl font-medium text-gray-900 mb-3"
                        style={{ fontFamily: "var(--brand-display-face)" }}
                    >
                        Support
                    </h1>
                    <p className="text-gray-600">
                        Reach us by email, or read the documentation for guides
                        and answers to common questions.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto pb-6 pt-6">
                    <div className="space-y-3">
                        <a
                            href={mailtoHref}
                            className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300"
                        >
                            <Mail
                                className="mt-0.5 h-5 w-5 shrink-0 text-gray-500"
                                aria-hidden="true"
                            />
                            <span className="min-w-0">
                                <span className="block font-medium text-gray-900">
                                    Email support
                                </span>
                                <span className="block break-words text-sm text-gray-600">
                                    {brand.supportEmail}
                                </span>
                            </span>
                        </a>

                        <a
                            href={brand.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300"
                        >
                            <BookOpen
                                className="mt-0.5 h-5 w-5 shrink-0 text-gray-500"
                                aria-hidden="true"
                            />
                            <span className="min-w-0">
                                <span className="block font-medium text-gray-900">
                                    Documentation
                                </span>
                                <span className="block break-words text-sm text-gray-600">
                                    {brand.docsUrl}
                                </span>
                            </span>
                        </a>
                    </div>

                    {user?.email && (
                        <p className="mt-4 text-sm text-gray-500">
                            We&apos;ll reply to{" "}
                            <span className="font-medium">{user.email}</span>.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
