// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { PAGE_HEADER_TITLE_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { EmptyState } from "@/app/components/ui/empty-state";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { useWorkspace, useWorkspaceOrgId } from "@/app/contexts/WorkspaceContext";
import { isOrgAdmin } from "@/app/lib/permissions";
import { RequestFormsManager } from "@/app/components/intake/RequestFormsManager";
import { pillButtonUIClassName } from "@/shared/ui/PillButtonUI.styles";

/**
 * Request forms live in an organization's workspace and are managed by its
 * owners and admins; everyone else is told where the request desk is. The
 * server refuses management calls from anyone else too.
 */
export default function RequestFormsPage() {
    const orgId = useWorkspaceOrgId();
    const { activeOrganization } = useWorkspace();

    if (!orgId) {
        return (
            <Explainer
                title="Switch to an organization"
                description="Request forms belong to an organization's request desk. Choose an organization from the workspace menu to manage its forms."
            />
        );
    }

    // The caller's role arrives with the organization list; until then the
    // page holds its place rather than flashing either answer.
    if (!activeOrganization) {
        return (
            <div className="flex h-full min-h-0 flex-col">
                <Header />
                <div aria-busy="true" className="mx-3 space-y-3 md:mx-6.5">
                    <div className="h-28 animate-pulse rounded-xl bg-surface" />
                </div>
            </div>
        );
    }

    if (!isOrgAdmin(activeOrganization.role)) {
        return (
            <Explainer
                title="Owners and admins manage request forms"
                description="Ask an owner or admin of this organization to create or change a form. Requests that arrive through a form are on the Intake board."
                action={
                    <Link href="/intake" className={pillButtonUIClassName({ tone: "black", size: "sm" })}>
                        Go to Intake
                    </Link>
                }
            />
        );
    }

    // The list, the open editor and the shown link all belong to the
    // organization that supplied them, so a workspace switch restarts them.
    return <RequestFormsManager key={orgId} workspace={orgId} />;
}

function Header() {
    return (
        <PageHeader>
            <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-fg`}>Request forms</h1>
        </PageHeader>
    );
}

function Explainer({
    title,
    description,
    action,
}: {
    title: string;
    description: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Header />
            <div className="mx-3 flex flex-1 items-center justify-center md:mx-6.5">
                <EmptyState
                    icon={<IntakeSkeuoIcon />}
                    title={title}
                    description={description}
                    action={action}
                />
            </div>
        </div>
    );
}
