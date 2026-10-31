import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlaybookFinding,
  PlaybookFindingDecision,
  PlaybookRun,
} from "@/app/lib/mikeApi";
import { PlaybookRuns } from "./PlaybookRuns";
import {
  subscribePlaybookRunChanges,
  useViewedPlaybookRun,
} from "@/app/lib/playbookRunActivity";

const api = vi.hoisted(() => ({
  listPlaybookRuns: vi.fn(),
  resolveDocumentEdit: vi.fn(),
  getPlaybookRunDecisions: vi.fn(),
  recordPlaybookDecision: vi.fn(),
  clearPlaybookDecision: vi.fn(),
  acceptMatchingPlaybookFindings: vi.fn(),
  listPlaybookEscalationMembers: vi.fn(),
  exportPlaybookDecisionRecord: vi.fn(),
}));
const viewer = vi.hoisted(() => ({ docx: vi.fn() }));
const download = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("@/app/lib/downloadDocument", () => download);
const toasts = vi.hoisted(() => ({ notifySuccess: vi.fn() }));
vi.mock("@/app/lib/userFacingError", async (original) => ({
  ...(await original<typeof import("@/app/lib/userFacingError")>()),
  notifySuccess: toasts.notifySuccess,
}));
// The real viewer lazy-loads a Word renderer that jsdom cannot run.
vi.mock("@/app/components/shared/views/DocxView", () => ({
  DocxView: (props: { documentId: string; refetchKey?: number }) => {
    viewer.docx(props);
    return (
      <div
        role="document"
        aria-label={`Document ${props.documentId}, revision ${props.refetchKey}`}
      />
    );
  },
}));
vi.mock("@/app/lib/mikeApi", async (original) => ({
  ...(await original<typeof import("@/app/lib/mikeApi")>()),
  ...api,
}));

// Showing a run's results, not the new-run form.
const resultsProps = () => ({
  canRun: true,
  composing: false,
  newRun: null,
  onNewRun: vi.fn(),
  onCloseNewRun: vi.fn(),
});

function run(overrides: Partial<PlaybookRun> = {}): PlaybookRun {
  return {
    id: "run-1",
    playbookId: "pb",
    model: "claude-opus-5-5",
    documentName: "Supply agreement.docx",
    reviewMode: "strict",
    status: "completed",
    summary: "One uncapped indemnity.",
    findings: [
      {
        id: "f-1",
        topicId: null,
        ruleId: "cap",
        ruleName: "Liability cap",
        status: "unacceptable",
        quote: "Liability is unlimited.",
        location: "Clause 9",
        analysis: "The cap is missing.",
        suggestedText: "Liability is capped at fees paid.",
      },
      {
        id: "f-2",
        topicId: null,
        ruleId: "law",
        ruleName: "Governing law",
        status: "needs_review",
        quote: "",
        location: "",
        analysis: "Unclear.",
        suggestedText: "",
      },
    ],
    error: null,
    startedAt: "2026-10-17T09:00:00.000Z",
    completedAt: "2026-10-17T09:01:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // No decisions yet, and a reviewed document outside any project.
  api.getPlaybookRunDecisions.mockImplementation(async (runId: string) => ({
    runId,
    project: null,
    decisions: [],
  }));
});

describe("playbook runs", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a review still running on the server, and its findings once it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const changed = vi.fn();
    const unsubscribe = subscribePlaybookRunChanges(changed);
    const viewed = renderHook(() => useViewedPlaybookRun());
    const running = run({ status: "running", summary: null, findings: [] });
    api.listPlaybookRuns.mockResolvedValue([running]);
    const { unmount } = render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );

    const list = screen.getByRole("region", { name: "Your runs" });
    expect(
      await within(list).findByRole("button", {
        name: "Supply agreement.docx, running",
      }),
    ).toBeVisible();
    const results = screen.getByRole("region", { name: "Run results" });
    expect(within(results).getByRole("status")).toHaveTextContent(
      "Reviewing Supply agreement.docx…",
    );
    // History is told which run is on screen, so it shows no tick for it.
    await waitFor(() => expect(viewed.result.current).toBe("run-1"));

    api.listPlaybookRuns.mockResolvedValue([run()]);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(await within(results).findByText("Liability cap")).toBeVisible();
    expect(
      within(list).getByRole("button", { name: "Supply agreement.docx" }),
    ).toBeVisible();
    // Other lists, such as History, are told it has finished.
    expect(changed).toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(viewed.result.current).toBeNull());
    unsubscribe();
  });

  it("keeps polling a running review through a failed poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = run({ status: "running", summary: null, findings: [] });
    api.listPlaybookRuns.mockResolvedValue([running]);
    render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );
    const results = screen.getByRole("region", { name: "Run results" });
    expect(await within(results).findByRole("status")).toHaveTextContent(
      "Reviewing Supply agreement.docx…",
    );

    api.listPlaybookRuns.mockRejectedValueOnce(new Error("offline"));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeVisible();
    // The running review stays on screen while the list could not refresh.
    expect(within(results).getByRole("status")).toHaveTextContent(
      "Reviewing Supply agreement.docx…",
    );

    api.listPlaybookRuns.mockResolvedValue([run()]);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await within(results).findByText("Liability cap")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("can show only the issues of a full review, without losing the rest", async () => {
    const full = run();
    api.listPlaybookRuns.mockResolvedValue([
      {
        ...full,
        findings: [
          ...full.findings,
          { ...full.findings[1], id: "f-3", ruleId: "term", ruleName: "Term", status: "acceptable" as const },
        ],
      },
    ]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const results = await screen.findByRole("region", { name: "Run results" });
    expect(await within(results).findByRole("region", { name: /Acceptable/ })).toBeVisible();

    const show = within(results).getByRole("group", { name: "Findings to show" });
    await userEvent.click(within(show).getByRole("button", { name: "Issues only" }));
    expect(within(results).queryByRole("region", { name: /Acceptable/ })).toBeNull();
    expect(within(results).getByRole("region", { name: /Issues/ })).toBeVisible();
    expect(within(results).getByRole("region", { name: /Needs review/ })).toBeVisible();

    await userEvent.click(within(show).getByRole("button", { name: "All findings" }));
    expect(within(results).getByRole("region", { name: /Acceptable/ })).toBeVisible();
  });

  it("names an issues-only run's scope and offers no filter for it", async () => {
    api.listPlaybookRuns.mockResolvedValue([run({ reviewScope: "issues" })]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const results = await screen.findByRole("region", { name: "Run results" });
    const details = await within(results).findByRole("region", { name: "Run details" });
    expect(within(details).getByText("Issues only")).toBeVisible();
    expect(within(results).queryByRole("group", { name: "Findings to show" })).toBeNull();
  });

  it("follows a run asked for after it opened", async () => {
    api.listPlaybookRuns.mockResolvedValue([
      run({ id: "new", documentName: "New.docx" }),
      run({ id: "old", documentName: "Old.docx" }),
    ]);
    const props = resultsProps();
    const { rerender } = render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...props} />,
    );
    const list = screen.getByRole("region", { name: "Your runs" });
    expect(
      await within(list).findByRole("button", { name: "New.docx" }),
    ).toHaveAttribute("aria-pressed", "true");

    rerender(
      <PlaybookRuns
        playbookId="pb"
        latestRun={null}
        {...props}
        initialRunId="old"
      />,
    );
    expect(within(list).getByRole("button", { name: "Old.docx" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The decisions shown are the newly selected run's.
    await waitFor(() =>
      expect(api.getPlaybookRunDecisions).toHaveBeenLastCalledWith("old"),
    );
    expect(await screen.findByText("0 of 2 findings decided")).toBeVisible();
  });

  it("opens the hidden document when a tracked change asks to be viewed", async () => {
    const reviewed = run();
    api.listPlaybookRuns.mockResolvedValue([
      {
        ...reviewed,
        documentId: "doc-1",
        editedVersionId: "v2",
        findings: [
          {
            ...reviewed.findings[0],
            edit: {
              kind: "edit" as const,
              edit_id: "e1",
              document_id: "doc-1",
              version_id: "v2",
              version_number: 2,
              change_id: "c1",
              deleted_text: "unlimited",
              inserted_text: "capped at fees paid",
              context_before: "Liability is ",
              context_after: ".",
              status: "pending" as const,
            },
          },
        ],
      },
    ]);
    render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );

    const issues = await screen.findByRole("region", { name: /Issues/ });
    expect(
      screen.queryByRole("region", { name: "Reviewed document" }),
    ).toBeNull();
    await userEvent.click(within(issues).getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("region", { name: "Reviewed document" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Close document" }),
    );
    expect(
      screen.queryByRole("region", { name: "Reviewed document" }),
    ).toBeNull();
  });

  it("shows a reviewed Word document beside its results and decides its tracked changes", async () => {
    const edit = {
      kind: "edit" as const,
      edit_id: "e1",
      document_id: "doc-1",
      version_id: "v2",
      version_number: 2,
      change_id: "c1",
      deleted_text: "unlimited",
      inserted_text: "capped at fees paid",
      context_before: "Liability is ",
      context_after: ".",
      status: "pending" as const,
    };
    const reviewed = run();
    api.listPlaybookRuns.mockResolvedValue([
      {
        ...reviewed,
        documentId: "doc-1",
        editedVersionId: "v2",
        findings: [{ ...reviewed.findings[0], edit }],
      },
    ]);
    api.resolveDocumentEdit.mockResolvedValue({
      ok: true,
      status: "accepted",
      version_id: "v3",
      download_url: null,
    });
    render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );

    // The document stays hidden until asked for, then opens to the right of
    // the results.
    const results = await screen.findByRole("region", { name: "Run results" });
    const view = await within(results).findByRole("button", {
      name: "View document",
    });
    expect(view).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("region", { name: "Reviewed document" }),
    ).toBeNull();
    expect(
      within(results).getByRole("heading", { level: 2, name: "Run results" }),
    ).toBeVisible();
    await userEvent.click(view);
    expect(view).toHaveAttribute("aria-pressed", "true");
    const pane = screen.getByRole("region", { name: "Reviewed document" });
    expect(
      screen.getByRole("separator", { name: "Resize runs panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize document panel" }),
    ).toBeInTheDocument();
    expect(
      results.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(pane).getByRole("document", {
        name: "Document doc-1, revision 0",
      }),
    ).toBeInTheDocument();
    // The document pane names the document; the heading stays the same.
    expect(
      within(pane).getByRole("heading", {
        level: 2,
        name: "Supply agreement.docx",
      }),
    ).toBeVisible();
    expect(
      within(results).getByRole("heading", { level: 2, name: "Run results" }),
    ).toBeVisible();
    // A change in the document is decided from an edit card.
    const issues = screen.getByRole("region", { name: /Issues/ });
    expect(within(issues).getByText("Recommended change")).toBeVisible();
    expect(within(issues).queryByText("Recommended changes")).toBeNull();

    await userEvent.click(
      within(issues).getByRole("button", { name: "Accept" }),
    );

    expect(api.resolveDocumentEdit).toHaveBeenCalledWith(
      "doc-1",
      "e1",
      "accept",
    );
    // The document reloads to show the change accepted.
    expect(
      await within(pane).findByRole("document", {
        name: "Document doc-1, revision 1",
      }),
    ).toBeInTheDocument();
  });

  it("lists past runs with their outcome and shows the selected run's findings", async () => {
    api.listPlaybookRuns.mockResolvedValue([
      run(),
      run({
        id: "run-0",
        documentName: "Old NDA.pdf",
        summary: "Nothing to change.",
        findings: [],
        startedAt: "2026-10-16T09:00:00.000Z",
      }),
    ]);
    render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );
    const list = screen.getByRole("region", { name: "Your runs" });
    const latest = await within(list).findByRole("button", {
      name: /Supply agreement\.docx/,
    });
    expect(latest).toHaveAttribute("aria-pressed", "true");
    // One line per run: the document alone, without the outcome.
    expect(latest).toHaveTextContent(/^Supply agreement\.docx$/);
    expect(api.listPlaybookRuns).toHaveBeenCalledWith("pb");
    const results = screen.getByRole("region", { name: "Run results" });
    // The heading names the pane; the selected row names the document.
    expect(
      within(results).getByRole("heading", { level: 2, name: "Run results" }),
    ).toBeVisible();
    // What was reviewed, how, and when, before the findings.
    const details = within(results).getByRole("region", { name: "Run details" });
    for (const label of ["Document", "Model", "Scope", "Posture", "Started"])
      expect(within(details).getByText(label)).toBeVisible();
    expect(within(details).getByText("Supply agreement.docx")).toBeVisible();
    expect(details.querySelector("time")).toHaveAttribute(
      "datetime",
      expect.stringMatching(/^2026-/),
    );
    // The header keeps only the heading and the document's button.
    expect(
      results.querySelector("h2")?.parentElement?.querySelector("time"),
    ).toBeNull();
    // Findings are grouped by urgency, each in its own card.
    const issues = within(results).getByRole("region", { name: /Issues/ });
    expect(within(issues).getByText("Liability cap")).toBeVisible();
    expect(within(issues).getByText("Unacceptable")).toBeVisible();
    expect(within(issues).getByText("Clause 9")).toBeVisible();
    // Each part of a finding says what it is.
    for (const label of ["Where", "Assessment", "Recommended changes"])
      expect(within(issues).getByText(label)).toBeVisible();
    // The recommendation is a redline of the contract language.
    const removed = issues.querySelector("del");
    const added = issues.querySelector("ins");
    expect(removed).toHaveTextContent("Removed: unlimited");
    expect(added).toHaveTextContent("Added: capped at fees paid");
    expect(within(issues).queryByText("Contract language")).toBeNull();
    const toReview = within(results).getByRole("region", {
      name: /Needs review/,
    });
    expect(within(toReview).getByText("Governing law")).toBeVisible();
    expect(
      within(results).queryByRole("region", { name: /Acceptable/ }),
    ).toBeNull();

    await userEvent.click(
      within(list).getByRole("button", { name: /Old NDA\.pdf/ }),
    );

    expect(within(results).getByText("Nothing to change.")).toBeVisible();
    expect(within(results).getByText("No findings.")).toBeVisible();
  });

  it("selects a run finished on the page before the history loads", async () => {
    api.listPlaybookRuns.mockResolvedValue([
      run({ id: "run-0", documentName: "Older.docx" }),
    ]);
    render(
      <PlaybookRuns
        playbookId="pb"
        latestRun={run({ id: "run-new", documentName: "Fresh.docx" })}
        {...resultsProps()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /Fresh\.docx/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Older\.docx/ })).toBeVisible();
  });

  it("refreshes history when a batch completes while the Runs tab is already open", async () => {
    api.listPlaybookRuns.mockResolvedValue([]);
    const { rerender } = render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );
    await screen.findByText("None yet.");
    const first = run({ id: "batch-1", documentName: "First.txt" });
    const second = run({ id: "batch-2", documentName: "Second.txt" });
    api.listPlaybookRuns.mockResolvedValue([second, first]);
    rerender(
      <PlaybookRuns playbookId="pb" latestRun={second} {...resultsProps()} />,
    );
    const list = screen.getByRole("region", { name: "Your runs" });
    expect(
      await within(list).findByRole("button", { name: "First.txt" }),
    ).toBeVisible();
    expect(
      within(list).getByRole("button", { name: "Second.txt" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(api.listPlaybookRuns).toHaveBeenCalledTimes(2);
  });

  it("offers a new run when there are none yet, and from the list header", async () => {
    api.listPlaybookRuns.mockResolvedValue([]);
    const props = resultsProps();
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...props} />);

    const results = screen.getByRole("region", { name: "Run results" });
    await userEvent.click(
      await within(results).findByRole("button", { name: "New run" }),
    );
    const list = screen.getByRole("region", { name: "Your runs" });
    await userEvent.click(
      within(list).getByRole("button", { name: "New run" }),
    );

    expect(props.onNewRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText("None yet.")).toBeVisible();
  });

  it("shows the new-run form in place of the results, and leaves it for a chosen run", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    const props = { ...resultsProps(), composing: true };
    render(
      <PlaybookRuns
        playbookId="pb"
        latestRun={null}
        {...props}
        newRun={<section aria-label="New run form" />}
      />,
    );

    const list = screen.getByRole("region", { name: "Your runs" });
    const row = await within(list).findByRole("button", {
      name: /Supply agreement\.docx/,
    });
    expect(screen.getByRole("region", { name: "New run form" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    // While the form is open, no run is shown as selected.
    expect(row).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(row);
    expect(props.onCloseNewRun).toHaveBeenCalled();
  });

  it("shows a failed run's error and retries a failed load", async () => {
    api.listPlaybookRuns
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([
        run({ error: "The model timed out.", findings: [] }),
      ]);
    render(
      <PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(
      await screen.findByRole("button", { name: /Supply agreement/ }),
    ).toBeVisible();
    expect(screen.getByText("The model timed out.")).toBeVisible();
  });
});

const jane = {
  userId: "u-jane",
  displayName: "Jane Doe",
  email: "jane@example.com",
};
const sam = { userId: "u-sam", displayName: "Sam Lee", email: "sam@example.com" };

function decision(
  findingId: string,
  overrides: Partial<PlaybookFindingDecision> = {},
): PlaybookFindingDecision {
  return {
    findingId,
    decision: "accepted",
    method: "single",
    note: null,
    escalatedTo: null,
    decidedBy: jane,
    decidedAt: "2026-10-31T10:02:00.000Z",
    ...overrides,
  };
}

/** One finding of each kind "Accept matching findings" has to tell apart. */
function mixedRun() {
  const [issue, review] = run().findings;
  const finding = (
    id: string,
    ruleName: string,
    status: PlaybookFinding["status"],
    matchedPosition?: PlaybookFinding["matchedPosition"],
  ): PlaybookFinding => ({
    ...review,
    id,
    ruleId: id,
    ruleName,
    status,
    ...(matchedPosition ? { matchedPosition } : {}),
  });
  return run({
    findings: [
      issue,
      review,
      finding("f-law", "Governing law clause", "acceptable", "standard"),
      finding("f-notices", "Notices", "acceptable", "standard"),
      finding("f-payment", "Payment terms", "acceptable", "fallback"),
      finding("f-term", "Term", "needs_review", "standard"),
      // Recorded before findings had a matched position.
      finding("f-assignment", "Assignment", "acceptable"),
    ],
  });
}

/** The text of a finding card's description for `term`. */
function definitionOf(card: HTMLElement, term: string) {
  return within(card).getByText(term, { selector: "dt" }).nextElementSibling
    ?.textContent;
}

const decide = (runId: string, findingId: string, payload: { decision: PlaybookFindingDecision["decision"]; note?: string }) =>
  decision(findingId, { decision: payload.decision, note: payload.note ?? null });

describe("finding decisions", () => {
  it("counts decided findings as decisions are recorded, changed and cleared", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    api.recordPlaybookDecision.mockImplementation(async (...args) =>
      decide(...(args as Parameters<typeof decide>)),
    );
    api.clearPlaybookDecision.mockResolvedValue(undefined);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);

    const counter = await screen.findByText("0 of 2 findings decided");
    expect(counter).toHaveAttribute("role", "status");
    expect(api.getPlaybookRunDecisions).toHaveBeenCalledWith("run-1");
    // AI output reaches the reviewer as a draft, with the disclaimer.
    expect(
      screen.getByText(
        "AI-generated draft for a lawyer to decide on. Legal information, not legal advice.",
      ),
    ).toBeVisible();

    const cap = screen.getByRole("group", { name: "Decision on Liability cap" });
    await userEvent.click(
      within(cap).getByRole("button", { name: "Accept finding: Liability cap" }),
    );
    expect(api.recordPlaybookDecision).toHaveBeenCalledWith("run-1", "f-1", {
      decision: "accepted",
    });
    expect(await screen.findByText("1 of 2 findings decided")).toBe(counter);
    expect(within(cap).getByText("Accepted by Jane Doe")).toBeVisible();

    // Changing it to an override keeps the count.
    await userEvent.click(
      within(cap).getByRole("button", { name: "Change decision: Liability cap" }),
    );
    await userEvent.click(
      within(cap).getByRole("button", { name: "Override: Liability cap" }),
    );
    await userEvent.type(
      within(cap).getByLabelText("Why are you overriding this finding?"),
      "Agreed with the client.",
    );
    await userEvent.click(within(cap).getByRole("button", { name: "Save override" }));
    expect(await within(cap).findByText("Overridden by Jane Doe")).toBeVisible();
    expect(counter).toHaveTextContent("1 of 2 findings decided");

    // Clearing it leaves the finding undecided again.
    await userEvent.click(
      within(cap).getByRole("button", { name: "Change decision: Liability cap" }),
    );
    await userEvent.click(
      within(cap).getByRole("button", { name: "Clear decision: Liability cap" }),
    );
    expect(api.clearPlaybookDecision).toHaveBeenCalledWith("run-1", "f-1");
    await waitFor(() =>
      expect(counter).toHaveTextContent("0 of 2 findings decided"),
    );
    expect(
      within(cap).getByRole("button", { name: "Accept finding: Liability cap" }),
    ).toBeVisible();
  });

  it("names every decision button after its finding", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    await screen.findByText("0 of 2 findings decided");

    for (const name of ["Liability cap", "Governing law"]) {
      const group = screen.getByRole("group", { name: `Decision on ${name}` });
      for (const action of ["Accept finding", "Override", "Escalate"]) {
        const button = within(group).getByRole("button", {
          name: `${action}: ${name}`,
        });
        // The visible label starts the accessible name.
        expect(button).toHaveTextContent(new RegExp(`^${action}`));
        expect(button).toHaveAttribute("type", "button");
      }
    }
    expect(
      screen.getByRole("button", { name: "Accept matching findings" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Export decision record" })).toBeVisible();
  });

  it("asks for a note before it overrides a finding", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    api.recordPlaybookDecision.mockImplementation(async (...args) =>
      decide(...(args as Parameters<typeof decide>)),
    );
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const group = await screen.findByRole("group", {
      name: "Decision on Liability cap",
    });
    await within(group).findByRole("button", { name: "Override: Liability cap" });

    await userEvent.click(
      within(group).getByRole("button", { name: "Override: Liability cap" }),
    );
    await userEvent.click(within(group).getByRole("button", { name: "Save override" }));

    expect(within(group).getByRole("alert")).toHaveTextContent(
      "Add a note saying why you are overriding this finding.",
    );
    const note = within(group).getByLabelText("Why are you overriding this finding?");
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(api.recordPlaybookDecision).not.toHaveBeenCalled();

    await userEvent.type(note, "The client accepts unlimited liability here.");
    await userEvent.click(within(group).getByRole("button", { name: "Save override" }));
    expect(api.recordPlaybookDecision).toHaveBeenCalledWith("run-1", "f-1", {
      decision: "overridden",
      note: "The client accepts unlimited liability here.",
    });
    expect(await within(group).findByText("Overridden by Jane Doe")).toBeVisible();
    expect(
      within(group).getByText("The client accepts unlimited liability here."),
    ).toBeVisible();
  });

  it("escalates a finding to a named member of the document's project", async () => {
    api.listPlaybookRuns.mockResolvedValue([run({ documentId: "doc-1" })]);
    api.getPlaybookRunDecisions.mockResolvedValue({
      runId: "run-1",
      project: { id: "p-1", name: "Acme supply matter", canAddDocuments: true },
      decisions: [],
    });
    api.listPlaybookEscalationMembers.mockResolvedValue([sam]);
    api.recordPlaybookDecision.mockImplementation(async (_runId, findingId) =>
      decision(findingId, { decision: "escalated", escalatedTo: sam }),
    );
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const group = await screen.findByRole("group", {
      name: "Decision on Governing law",
    });

    await userEvent.click(
      await within(group).findByRole("button", { name: "Escalate: Governing law" }),
    );
    await userEvent.selectOptions(
      await within(group).findByLabelText("Escalate to"),
      "u-sam",
    );
    await userEvent.click(within(group).getByRole("button", { name: "Escalate finding" }));

    expect(api.listPlaybookEscalationMembers).toHaveBeenCalledWith("run-1");
    expect(api.recordPlaybookDecision).toHaveBeenCalledWith("run-1", "f-2", {
      decision: "escalated",
      escalatedTo: "u-sam",
    });
    expect(await within(group).findByText("Escalated to Sam Lee")).toBeVisible();
    expect(within(group).getByText("Escalated by Jane Doe")).toBeVisible();
  });

  it("says why a finding cannot be escalated when the document is in no project", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const group = await screen.findByRole("group", {
      name: "Decision on Governing law",
    });

    await userEvent.click(
      await within(group).findByRole("button", { name: "Escalate: Governing law" }),
    );

    expect(within(group).getByText(/not in a project you can open/)).toBeVisible();
    expect(within(group).queryByLabelText("Escalate to")).toBeNull();
    expect(api.listPlaybookEscalationMembers).not.toHaveBeenCalled();
  });

  it("shows the AI's recommendation and matched position, reading older runs as none", async () => {
    const [issue, review] = run().findings;
    api.listPlaybookRuns.mockResolvedValue([
      run({
        findings: [
          // Recorded before findings had a matched position.
          issue,
          { ...review, status: "acceptable", matchedPosition: "fallback" },
        ],
      }),
    ]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);

    const older = await screen.findByRole("article", { name: "Liability cap" });
    expect(definitionOf(older, "Matched position")).toBe("None");
    expect(definitionOf(older, "AI recommendation")).toBe("Revise to meet the playbook");
    // Its reasons and suggested language stay on the card.
    expect(within(older).getByText("The cap is missing.")).toBeVisible();
    expect(within(older).getByText("Recommended changes")).toBeVisible();

    const fallback = screen.getByRole("article", { name: "Governing law" });
    expect(definitionOf(fallback, "Matched position")).toBe("Fallback");
    expect(definitionOf(fallback, "AI recommendation")).toBe("Accept as drafted");
  });

  it("lists exactly the standard-position acceptable findings before accepting them in bulk", async () => {
    api.listPlaybookRuns.mockResolvedValue([mixedRun()]);
    api.acceptMatchingPlaybookFindings.mockImplementation(
      async (runId: string, ids: string[]) => ({
        runId,
        project: null,
        decisions: ids.map((id) => decision(id, { method: "bulk" })),
      }),
    );
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    const counter = await screen.findByText("0 of 7 findings decided");

    await userEvent.click(
      screen.getByRole("button", { name: "Accept matching findings" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Accept matching findings?" });
    const listed = within(
      within(dialog).getByRole("list", { name: "Findings to accept" }),
    ).getAllByRole("listitem");
    // Not the fallback match, the standard match that needs review, the
    // older finding with no matched position, or the issues.
    expect(listed.map((item) => item.textContent)).toEqual([
      "Governing law clause",
      "Notices",
    ]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Accept 2 findings" }));

    expect(api.acceptMatchingPlaybookFindings).toHaveBeenCalledWith("run-1", [
      "f-law",
      "f-notices",
    ]);
    await waitFor(() => expect(counter).toHaveTextContent("2 of 7 findings decided"));
    expect(
      within(screen.getByRole("article", { name: "Notices" })).getByText(
        "Accepted by Jane Doe, in bulk",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accept matching findings" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("dialog", { name: "Accept matching findings?" }),
    ).toBeNull();
  });

  it("leaves a finding already decided out of the matching findings", async () => {
    api.listPlaybookRuns.mockResolvedValue([mixedRun()]);
    api.getPlaybookRunDecisions.mockResolvedValue({
      runId: "run-1",
      project: null,
      decisions: [
        decision("f-law", { decision: "overridden", note: "Another law was agreed." }),
      ],
    });
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    await screen.findByText("1 of 7 findings decided");

    await userEvent.click(
      screen.getByRole("button", { name: "Accept matching findings" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Accept matching findings?" });
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Notices"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.acceptMatchingPlaybookFindings).not.toHaveBeenCalled();
  });

  it("exports the decision record to the project, or downloads it", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    const blob = new Blob(["PK"]);
    api.exportPlaybookDecisionRecord
      .mockResolvedValueOnce({
        kind: "download",
        blob,
        filename: "Supply agreement - decision record.docx",
      })
      .mockResolvedValueOnce({
        kind: "saved",
        saved: {
          documentId: "d-1",
          projectId: "p-1",
          projectName: "Acme supply matter",
          filename: "Supply agreement - decision record.docx",
        },
      });
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    await screen.findByText("0 of 2 findings decided");
    const exportButton = screen.getByRole("button", { name: "Export decision record" });

    await userEvent.click(exportButton);
    await waitFor(() =>
      expect(download.downloadBlob).toHaveBeenCalledWith(
        blob,
        "Supply agreement - decision record.docx",
      ),
    );

    await userEvent.click(exportButton);
    await waitFor(() =>
      expect(toasts.notifySuccess).toHaveBeenCalledWith(
        "Decision record saved to Acme supply matter.",
      ),
    );
    expect(api.exportPlaybookDecisionRecord).toHaveBeenCalledWith("run-1");
    expect(download.downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("says when decisions could not be loaded, and reloads them", async () => {
    api.listPlaybookRuns.mockResolvedValue([run()]);
    api.getPlaybookRunDecisions
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ runId: "run-1", project: null, decisions: [] });
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Decisions could not be loaded.",
    );
    expect(
      screen.getByRole("button", { name: "Accept matching findings" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Accept finding: Liability cap" }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reload decisions" }));
    expect(await screen.findByText("0 of 2 findings decided")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accept finding: Liability cap" }),
    ).toBeVisible();
  });

  it("offers no decisions on a run that is still running or failed", async () => {
    api.listPlaybookRuns.mockResolvedValue([
      run({ error: "The model timed out.", findings: [] }),
    ]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);
    expect(await screen.findByText("The model timed out.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export decision record" })).toBeNull();
    expect(api.getPlaybookRunDecisions).not.toHaveBeenCalled();
  });

  it("labels a finished run's AI summary as a draft even with no findings to decide", async () => {
    api.listPlaybookRuns.mockResolvedValue([
      run({ summary: "Nothing to change.", findings: [] }),
    ]);
    render(<PlaybookRuns playbookId="pb" latestRun={null} {...resultsProps()} />);

    expect(await screen.findByText("Nothing to change.")).toBeVisible();
    expect(
      screen.getByText(
        "AI-generated draft for a lawyer to decide on. Legal information, not legal advice.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export decision record" })).toBeNull();
    expect(api.getPlaybookRunDecisions).not.toHaveBeenCalled();
  });
});
