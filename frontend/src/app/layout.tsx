import type { CSSProperties } from "react";
import type { Metadata } from "next";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { brand } from "@/shared/brand.generated";
import { THEME_COLOR } from "@/app/lib/theme";
import { themeScript } from "@/app/lib/themeScript";

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
// --brand-primary-dark is set only when the brand config carries one, so the
// dark-surface brand fill otherwise falls back to the navy primary (see the
// .dark brand override in DesignTokensUI.css).
const brandStyle = {
    "--brand-primary": brand.palette.primary,
    "--brand-on-primary": brand.palette.onPrimary,
    ...(brand.palette.primaryDark
        ? { "--brand-primary-dark": brand.palette.primaryDark }
        : {}),
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
        // suppressHydrationWarning: the pre-paint script below sets the `.dark`
        // class and color-scheme on <html> before React hydrates, so the
        // server and client markup differ by design on this one element.
        <html lang="en" style={brandStyle} suppressHydrationWarning>
            <head>
                {/* Updated per resolved theme by the pre-paint script and by
                    applyTheme; the default is the light surface tint. */}
                <meta name="theme-color" content={THEME_COLOR.light} />
                {/* Set .dark, color-scheme and theme-color from the localStorage
                    mirror before first paint, so a dark-mode user never sees a
                    flash of the light frame. */}
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body
                className="font-sans antialiased"
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
