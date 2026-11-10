import Link from "next/link";
import { brand } from "@/shared/brand.generated";
import { BrandMark } from "@/shared/ui/BrandMarkUI";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    iconClassName?: string;
    animate?: boolean;
    asLink?: boolean;
}

export function SiteLogo({
    size = "md",
    className = "",
    iconClassName = "",
    animate = false,
    asLink = false,
}: SiteLogoProps) {
    const landingHref =
        process.env.NODE_ENV === "production"
            ? brand.marketingUrl
            : "http://localhost:3000";
    const sizeClasses = {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-6xl",
    };

    const iconSizes = {
        sm: 20,
        md: 22,
        lg: 30,
        xl: 48,
    };

    const logo = (
        <h1
            className={`flex items-center gap-1.5 ${sizeClasses[size]} font-light ${
                animate ? "sidebar-fade-in" : ""
            } ${className}`}
            style={{ fontFamily: "var(--brand-display-face)" }}
        >
            <span
                className={`inline-flex shrink-0 items-center leading-none ${iconClassName}`}
            >
                <BrandMark size={iconSizes[size]} />
            </span>
            <span>{brand.productName}</span>
        </h1>
    );

    if (asLink) {
        return (
            <Link
                href={landingHref}
                className="cursor-pointer hover:opacity-80 transition-opacity duration-(--motion-duration-fast) ease-out-soft"
            >
                {logo}
            </Link>
        );
    }

    return logo;
}
