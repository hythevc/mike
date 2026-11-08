import type { CSSProperties } from "react";
import type { Metadata } from "next";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { brand } from "@/shared/brand.generated";

const title = `${brand.productName} — Legal AI`;
const description =
    "An AI copilot for reviewing, drafting and negotiating legal documents. Legal information, not legal advice.";

export const metadata: Metadata = {
    metadataBase: new URL(brand.appUrl),
    title,
    description,
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/favicon.ico" },
        ],
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        url: brand.appUrl,
        siteName: brand.productName,
        title,
        description,
        images: [
            {
                url: brand.assets.ogImage,
                width: 1200,
                height: 630,
                alt: brand.productName,
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [brand.assets.ogImage],
    },
};

// The brand palette and display face, set once on the root so the whole app
// and its auth and loader screens read them. W11 consumes the primary slots
// through the semantic tokens; the display face names the wordmark's type.
const brandStyle = {
    "--brand-primary": brand.palette.primary,
    "--brand-on-primary": brand.palette.onPrimary,
    "--brand-display-face":
        brand.displayFace === "eb-garamond"
            ? "var(--font-eb-garamond)"
            : "var(--font-inter)",
} as CSSProperties;

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" style={brandStyle}>
            <body
                className="font-sans antialiased"
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
