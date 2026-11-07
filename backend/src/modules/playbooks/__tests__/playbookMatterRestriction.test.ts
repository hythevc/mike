// SPDX-License-Identifier: AGPL-3.0-only
//
// A playbook review of a stored document in a matter whose client has switched
// AI off is refused before any provider call (W18). beginPlaybookReview reads
// the document through loadReviewDocument, which calls assertMatterAllowsAi
// before the playbook_runs insert and before the model work; the gate throws
// MatterAiRestrictedError, which playbooks.routes.ts maps to 403 with the
// matter_ai_restricted code. The run is never recorded, so a provider call is
// never reached.

import { describe, expect, it } from "vitest";
import {
  MatterAiRestrictedError,
  MATTER_AI_RESTRICTED_CODE,
} from "../../../lib/matterAi";
import { beginPlaybookReview } from "../playbooks.operations";
import { database } from "./playbookTestDb";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const DOC = "00000000-0000-4000-8000-000000000060";

describe("beginPlaybookReview and a restricted matter", () => {
  it("refuses with matter_ai_restricted before the run is recorded", async () => {
    // The owner's own personal document (org_id null) sits in matter PROJECT,
    // which has AI switched off. The same project row answers both the access
    // check and the AI-setting read, so access passes and the matter gate
    // fires before loadActiveVersion, the playbook_runs insert, or any model.
    const { db, tables } = database([]);
    tables.documents = [
      { id: DOC, user_id: OWNER, project_id: PROJECT, org_id: null, workflow_id: null },
    ];
    tables.projects = [
      {
        id: PROJECT,
        user_id: OWNER,
        org_id: null,
        visibility: "private",
        archived_at: null,
        ai_restricted: true,
      },
    ];

    const run = beginPlaybookReview({
      userId: OWNER,
      userEmail: "owner@example.com",
      playbookId: "book",
      documentId: DOC,
      model: "claude-opus-5",
      reviewMode: "strict",
      db,
    });

    await expect(run).rejects.toBeInstanceOf(MatterAiRestrictedError);
    await run.catch((error: unknown) => {
      expect(error).toMatchObject({ code: MATTER_AI_RESTRICTED_CODE, projectId: PROJECT });
    });
    // The gate fired before the insert: no run was recorded.
    expect(tables.playbook_runs).toEqual([]);
  });
});
