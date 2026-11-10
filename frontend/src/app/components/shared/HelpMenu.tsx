// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import {
    BookOpen,
    CircleHelp,
    Code,
    Info,
    Keyboard,
    LifeBuoy,
    Scale,
    ShieldCheck,
} from "lucide-react";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownTrigger,
} from "@/shared/ui/dropdown";
import { LIQUID_GLASS_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import { cn } from "@/app/lib/utils";
import { brand } from "@/shared/brand.generated";
import { useCommandMenu } from "@/app/components/shared/CommandMenu";
import { HELP_MENU_LABELS } from "@/app/components/shared/helpMenuLabels";

/**
 * Help, documentation, support and the legal pages, as a menu. Rendered two
 * ways: inline in the sidebar's account menu (HelpMenuItems) and as a
 * standalone menu in the mobile header (HelpMenu). Every destination is a real
 * link whose address comes from the brand module; "Keyboard shortcuts" opens
 * the shortcuts dialog.
 */

interface HelpLink {
    id: string;
    label: string;
    href: string;
    icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    external?: boolean;
}

const HELP_LINKS: HelpLink[] = [
    {
        id: "documentation",
        label: HELP_MENU_LABELS.documentation,
        href: brand.docsUrl,
        icon: BookOpen,
        external: true,
    },
    {
        id: "support",
        label: HELP_MENU_LABELS.support,
        href: "/support",
        icon: LifeBuoy,
    },
    { id: "about", label: HELP_MENU_LABELS.about, href: "/settings/about", icon: Info },
    { id: "source", label: HELP_MENU_LABELS.sourceCode, href: "/source", icon: Code },
    {
        id: "terms",
        label: HELP_MENU_LABELS.terms,
        href: brand.legalDocuments.terms.url,
        icon: Scale,
    },
    {
        id: "privacy",
        label: HELP_MENU_LABELS.privacy,
        href: brand.legalDocuments.privacy.url,
        icon: ShieldCheck,
    },
];

const ICON_CLASS = "h-3.5 w-3.5 shrink-0";

/**
 * The help entries as dropdown items. Render inside a `DropdownContent` (the
 * standalone menu) or an existing menu (the account menu, with a leading
 * separator).
 */
export function HelpMenuItems({
    leadingSeparator = false,
}: {
    leadingSeparator?: boolean;
}): React.ReactElement {
    const { openKeyboardShortcuts } = useCommandMenu();
    return (
        <>
            {leadingSeparator ? <DropdownSeparator /> : null}
            <DropdownItem asChild>
                <a
                    href={HELP_LINKS[0]!.href}
                    target="_blank"
                    rel="noreferrer"
                >
                    <BookOpen aria-hidden className={ICON_CLASS} />
                    {HELP_MENU_LABELS.documentation}
                </a>
            </DropdownItem>
            <DropdownItem onSelect={() => openKeyboardShortcuts()}>
                <Keyboard aria-hidden className={ICON_CLASS} />
                {HELP_MENU_LABELS.keyboardShortcuts}
            </DropdownItem>
            {HELP_LINKS.slice(1).map((link) => {
                const Icon = link.icon;
                return (
                    <DropdownItem key={link.id} asChild>
                        <Link href={link.href}>
                            <Icon aria-hidden className={ICON_CLASS} />
                            {link.label}
                        </Link>
                    </DropdownItem>
                );
            })}
        </>
    );
}

/** The standalone help menu: an icon trigger opening the help entries. */
export function HelpMenu({
    triggerClassName,
}: {
    triggerClassName?: string;
}): React.ReactElement {
    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label={HELP_MENU_LABELS.trigger}
                    className={cn(
                        "inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                        LIQUID_GLASS_HOVER_CLASS,
                        triggerClassName,
                    )}
                >
                    <CircleHelp aria-hidden className="h-4 w-4" />
                </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="w-52">
                <HelpMenuItems />
            </DropdownContent>
        </Dropdown>
    );
}
