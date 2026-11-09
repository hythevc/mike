// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    addIntakeRequestComment,
    assignIntakeRequest,
    changeIntakeRequestStatus,
    createIntakeMatter,
    createIntakeRequest,
    getIntakeBoard,
    getIntakeRequest,
    listIntakeRequestComments,
    listIntakeRequests,
    updateIntakeRequest,
} from "./mikeApi";

const fetchMock = vi.fn();
const WORKSPACE = "org/one?two";
const REQUEST = "request/one?two";
const REQUEST_PATH = "/api/intake/requests/request%2Fone%3Ftwo";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("request desk API requests", () => {
    it.each([
        {
            name: "list without filters",
            call: () => listIntakeRequests(WORKSPACE),
            url: "/api/intake/requests?workspace=org%2Fone%3Ftwo",
            method: "GET",
            body: undefined,
        },
        {
            name: "board summary",
            call: () => getIntakeBoard(WORKSPACE),
            url: "/api/intake/board?workspace=org%2Fone%3Ftwo",
            method: "GET",
            body: undefined,
        },
        {
            name: "read request",
            call: () => getIntakeRequest(REQUEST),
            url: REQUEST_PATH,
            method: "GET",
            body: undefined,
        },
        {
            name: "create request",
            call: () => createIntakeRequest(WORKSPACE, {
                title: "Review NDA",
                details: "Please review before Friday.",
                priority: "high",
                assignee_email: "lawyer@example.com",
            }),
            url: "/api/intake/requests",
            method: "POST",
            body: {
                title: "Review NDA",
                details: "Please review before Friday.",
                priority: "high",
                assignee_email: "lawyer@example.com",
                org_id: WORKSPACE,
            },
        },
        {
            name: "edit request",
            call: () => updateIntakeRequest(REQUEST, { priority: "urgent" }),
            url: REQUEST_PATH,
            method: "PATCH",
            body: { priority: "urgent" },
        },
        {
            name: "change status with defaults",
            call: () => changeIntakeRequestStatus(REQUEST, "closed"),
            url: `${REQUEST_PATH}/status`,
            method: "POST",
            body: { status: "closed" },
        },
        {
            name: "change status with a concurrency guard and note",
            call: () => changeIntakeRequestStatus(REQUEST, "waiting", {
                note: "Waiting for the signed copy.",
                expectedStatus: "in_progress",
            }),
            url: `${REQUEST_PATH}/status`,
            method: "POST",
            body: {
                status: "waiting",
                note: "Waiting for the signed copy.",
                expected_status: "in_progress",
            },
        },
        {
            name: "assign request",
            call: () => assignIntakeRequest(REQUEST, "lawyer@example.com"),
            url: `${REQUEST_PATH}/assignee`,
            method: "PUT",
            body: { assignee_email: "lawyer@example.com" },
        },
        {
            name: "unassign request",
            call: () => assignIntakeRequest(REQUEST, null),
            url: `${REQUEST_PATH}/assignee`,
            method: "PUT",
            body: { assignee_email: null },
        },
        {
            name: "read activity",
            call: () => listIntakeRequestComments(REQUEST),
            url: `${REQUEST_PATH}/comments`,
            method: "GET",
            body: undefined,
        },
        {
            name: "add comment",
            call: () => addIntakeRequestComment(REQUEST, "The signed copy arrived."),
            url: `${REQUEST_PATH}/comments`,
            method: "POST",
            body: { body: "The signed copy arrived." },
        },
        {
            name: "create matter with defaults",
            call: () => createIntakeMatter(REQUEST),
            url: `${REQUEST_PATH}/matter`,
            method: "POST",
            body: {},
        },
        {
            name: "create matter with details",
            call: () => createIntakeMatter(REQUEST, {
                name: "Acme NDA", cm_number: "CM-7", practice: "Commercial", visibility: "private",
            }),
            url: `${REQUEST_PATH}/matter`,
            method: "POST",
            body: { name: "Acme NDA", cm_number: "CM-7", practice: "Commercial", visibility: "private" },
        },
    ])("sends $name with the route and JSON contract", async ({ call, url, method, body }) => {
        const response = { id: "request-7", reference: "REQ-7" };
        fetchMock.mockResolvedValueOnce(json(response));
        await expect(call()).resolves.toEqual(response);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        expect(init.credentials).toBe("include");
        if (body === undefined) expect(init.body).toBeUndefined();
        else {
            expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
            expect(JSON.parse(init.body as string)).toEqual(body);
        }
    });

    it("serializes every list filter and preserves a zero pagination offset", async () => {
        fetchMock.mockResolvedValueOnce(json({ requests: [], total: 0 }));
        await listIntakeRequests(WORKSPACE, {
            statuses: ["new", "waiting"], priorities: ["high", "urgent"],
            assignee: "member/one", overdue: true, dueBefore: "2026-11-20T12:00:00Z",
            sortKey: "priority", sortDirection: "desc", limit: 20, offset: 0,
        });
        const url = new URL(fetchMock.mock.calls[0][0] as string, "https://example.test");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            workspace: WORKSPACE, status: "new,waiting", priority: "high,urgent",
            assignee: "member/one", overdue: "true", due_before: "2026-11-20T12:00:00Z",
            sort_key: "priority", sort_direction: "desc", limit: "20", offset: "0",
        });
    });

    it("omits cleared filters and preserves an explicitly zero limit", async () => {
        fetchMock.mockResolvedValueOnce(json({ requests: [], total: 0 }));
        await listIntakeRequests(WORKSPACE, {
            statuses: [], priorities: [], assignee: "", overdue: false,
            dueBefore: "", limit: 0,
        });
        expect(fetchMock.mock.calls[0][0]).toBe(
            "/api/intake/requests?workspace=org%2Fone%3Ftwo&limit=0",
        );
    });

    it.each([
        ["list", (signal: AbortSignal) => listIntakeRequests(WORKSPACE, {}, signal)],
        ["board", (signal: AbortSignal) => getIntakeBoard(WORKSPACE, signal)],
        ["request", (signal: AbortSignal) => getIntakeRequest(REQUEST, signal)],
        ["comments", (signal: AbortSignal) => listIntakeRequestComments(REQUEST, signal)],
    ] as const)("passes the caller's abort signal for %s", async (_name, call) => {
        const controller = new AbortController();
        fetchMock.mockResolvedValueOnce(json({}));
        await call(controller.signal);
        expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it("preserves an explicit empty status note", async () => {
        fetchMock.mockResolvedValueOnce(json({}));
        await changeIntakeRequestStatus(REQUEST, "waiting", { note: "" });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "waiting", note: "" });
    });

    it("surfaces a concurrent status change as an API error", async () => {
        fetchMock.mockResolvedValueOnce(json({ code: "conflict", detail: "This request changed." }, 409));
        const failure = await changeIntakeRequestStatus(REQUEST, "closed", {
            expectedStatus: "in_progress",
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(MikeApiError);
        expect(failure).toMatchObject({ status: 409, code: "conflict", message: "This request changed." });
    });
});
