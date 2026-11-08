// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { PageHeader } from "@/app/components/shared/PageHeader";
import { PAGE_HEADER_TITLE_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { EmptyState } from "@/app/components/ui/empty-state";
import { IntakeSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { useWorkspaceOrgId } from "@/app/contexts/WorkspaceContext";
import { IntakeBoard } from "@/app/components/intake/IntakeBoard";

export default function IntakePage() {
    const orgId = useWorkspaceOrgId();

    if (!orgId) {
        return (
            <div className="flex h-full min-h-0 flex-col">
                <PageHeader>
                    <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-gray-900`}>
                        Intake
                    </h1>
                </PageHeader>
                <div className="mx-3 flex flex-1 items-center justify-center md:mx-6.5">
                    <EmptyState
                        icon={<IntakeSkeuoIcon />}
                        title="Switch to an organization"
                        description="The request desk lives in an organization's workspace. Choose an organization from the workspace menu to see and triage its requests."
                    />
                </div>
            </div>
        );
    }

    // Filters, the open request and the New request form all belong to the
    // organization that supplied the board, so a workspace switch restarts them.
    return <IntakeBoard key={orgId} workspace={orgId} />;
}
