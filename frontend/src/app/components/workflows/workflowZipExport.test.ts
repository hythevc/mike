// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Workflow } from "../shared/types";
import type { WorkflowAttributionInfo } from "./workflowStatusLabels";
import { workflowFiles } from "./workflowZipExport";

function workflow(overrides?: Partial<Workflow["metadata"]>): Workflow {
  return {
    id: "wf-1",
    user_id: "u-1",
    metadata: {
      title: "Opposing Counsel Review",
      description: "Stress-test a contract for adverse arguments.",
      type: "assistant",
      contributors: [
        { name: "Jane Firm", organisation: null, role: null, linkedin: null },
      ],
      language: "English",
      version: "1.2.0",
      practice: "Dispute Resolution",
      jurisdictions: ["United States"],
      ...overrides,
    },
    skill_md: "# Opposing Counsel Review\nDo the review.",
    columns_config: null,
    is_system: false,
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

const attribution: WorkflowAttributionInfo = {
  license: "Apache-2.0",
  licenseEvidence: "file",
  attribution: "Based on Opposing Counsel Review by Larissa Meredith-Flister.",
  adaptedFromTitle: "Opposing Counsel Review",
  provenance: {
    catalog_repository: "Open-Legal-Products/mike-workflows",
    catalog_path: "assistant-workflows/opposing-counsel-review",
    license_file: "assistant-workflows/opposing-counsel-review/LICENSE",
    source_repository: "hythevc/awesome-legal-skills",
    source_path: "skills/opposing-counsel-review",
    source_commit: "f9f28cd",
    source_name: "Opposing Counsel Review",
    source_version: "2026-04-26",
    review_by: null,
    catalog_commit: "ce62e6a2",
    contributors: [],
    content_sha256: "abc123",
  },
  noticeMd: "Opposing Counsel Review\nCopyright 2026 Larissa Meredith-Flister.",
  changesMd: "## 1.2.0 - 2026-10-01\n- Converted to workflow format.",
  commit: "ce62e6a2",
  status: null,
  modificationNotice: "Modified by your organisation",
};

function fileByPath(
  files: { path: string; content: string }[],
  suffix: string,
): { path: string; content: string } | undefined {
  return files.find((file) => file.path.endsWith(suffix));
}

describe("workflowFiles attribution", () => {
  it("writes the licence and attribution into the exported frontmatter", () => {
    const { files } = workflowFiles(
      workflow(),
      "# Opposing Counsel Review\nDo the review.",
      [],
      attribution,
    );
    const skill = fileByPath(files, "/SKILL.md");
    expect(skill).toBeDefined();
    expect(skill!.content).toContain('license: "Apache-2.0"');
    expect(skill!.content).toContain(
      'attribution: "Based on Opposing Counsel Review by Larissa Meredith-Flister."',
    );
  });

  it("adds LICENSE, NOTICE and CHANGES.md to the zip for a catalog workflow", () => {
    const { files } = workflowFiles(workflow(), "body", [], attribution);
    const license = fileByPath(files, "/LICENSE");
    const notice = fileByPath(files, "/NOTICE");
    const changes = fileByPath(files, "/CHANGES.md");

    expect(license).toBeDefined();
    expect(notice).toBeDefined();
    expect(changes).toBeDefined();

    // LICENSE records the SPDX id and links the Corresponding Source at the
    // revision the copy was made from.
    expect(license!.content).toContain("SPDX-License-Identifier: Apache-2.0");
    expect(license!.content).toContain(
      "https://github.com/Open-Legal-Products/mike-workflows/tree/ce62e6a2/assistant-workflows/opposing-counsel-review",
    );
    expect(license!.content).toContain("without warranty");

    // NOTICE reproduces the upstream notice verbatim, then our modification
    // notice in its own block.
    expect(notice!.content).toContain(
      "Copyright 2026 Larissa Meredith-Flister.",
    );
    expect(notice!.content).toContain("Modified by your organisation");

    // CHANGES.md carries the change log verbatim when the payload has it.
    expect(changes!.content).toContain("Converted to workflow format");
  });

  it("omits the licence files for a workflow with no catalog attribution", () => {
    const { files } = workflowFiles(workflow(), "body", []);
    expect(files.map((file) => file.path.split("/").pop())).toEqual([
      "SKILL.md",
    ]);
    const skill = fileByPath(files, "/SKILL.md");
    expect(skill!.content).not.toContain("license:");
    expect(skill!.content).not.toContain("attribution:");
  });

  it("synthesises NOTICE and CHANGES.md when the copy carries no text", () => {
    const { files } = workflowFiles(workflow(), "body", [], {
      ...attribution,
      noticeMd: null,
      changesMd: null,
    });
    const notice = fileByPath(files, "/NOTICE");
    const changes = fileByPath(files, "/CHANGES.md");
    expect(notice!.content).toContain(
      "Based on Opposing Counsel Review by Larissa Meredith-Flister.",
    );
    expect(changes!.content).toContain("Modified by your organisation");
  });
});
