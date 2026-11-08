// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from "react";
import {
    ChatSkeuoIcon,
    FolderSkeuoIcon,
    IdeSkeuoIcon,
    IntakeSkeuoIcon,
    LibrarySkeuoIcon,
    PlaybookSkeuoIcon,
    TabularReviewSkeuoIcon,
    WorkflowSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";

/** One destination in the sidebar's primary navigation. */
export interface NavItem {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    /**
     * Current only on its own path, not on the pages below it. A chat under
     * /assistant and a project under /projects are marked current by their
     * row in the sidebar's History and Recent Projects lists instead.
     */
    exact?: boolean;
    /**
     * Shown only while an organization workspace is active. The request desk
     * belongs to an organization, so it is hidden in the Personal workspace.
     */
    organizationOnly?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
    { href: "/assistant", label: "Assistant", icon: ChatSkeuoIcon, exact: true },
    { href: "/ide", label: "IDE", icon: IdeSkeuoIcon },
    { href: "/projects", label: "Projects", icon: FolderSkeuoIcon, exact: true },
    { href: "/library", label: "Library", icon: LibrarySkeuoIcon },
    {
        href: "/tabular-reviews",
        label: "Tabular Review",
        icon: TabularReviewSkeuoIcon,
    },
    { href: "/workflows", label: "Workflows", icon: WorkflowSkeuoIcon },
    { href: "/playbooks", label: "Playbooks", icon: PlaybookSkeuoIcon },
    {
        href: "/intake",
        label: "Intake",
        icon: IntakeSkeuoIcon,
        exact: true,
        organizationOnly: true,
    },
];

/**
 * The navigation items to show for the active workspace. Organization-only
 * items drop out of the Personal workspace, where they have nothing to show.
 */
export function navItemsForWorkspace({
    inOrganization,
}: {
    inOrganization: boolean;
}): NavItem[] {
    return NAV_ITEMS.filter(
        (item) => inOrganization || !item.organizationOnly,
    );
}

/** Whether `item` is the page on screen, which the sidebar marks with aria-current. */
export function isNavItemCurrent(item: NavItem, pathname: string): boolean {
    if (pathname === item.href) return true;
    return !item.exact && pathname.startsWith(`${item.href}/`);
}
