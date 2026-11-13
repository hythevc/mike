// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    createProject,
    getJurisdictionRegistry,
    getOrgMatterDefaults,
    setOrgMatterDefaults,
    updateProject,
} from "./mikeApi";

const fetchMock = vi.fn();
const ORG = "org/one?two";
const ORG_PATH = "/api/orgs/org%2Fone%3Ftwo/matter-defaults";

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

describe("jurisdiction profile API requests", () => {
    it.each([
        {
            name: "reads the jurisdiction registry",
            call: () => getJurisdictionRegistry(),
            url: "/api/projects/jurisdictions",
            method: "GET",
            body: undefined,
        },
        {
            name: "reads an organization's matter defaults",
            call: () => getOrgMatterDefaults(ORG),
            url: ORG_PATH,
            method: "GET",
            body: undefined,
        },
        {
            name: "sets both matter defaults",
            call: () =>
                setOrgMatterDefaults(ORG, {
                    default_jurisdictions: ["GB", "EU"],
                    default_working_language: "en-GB",
                }),
            url: ORG_PATH,
            method: "PUT",
            body: {
                default_jurisdictions: ["GB", "EU"],
                default_working_language: "en-GB",
            },
        },
        {
            name: "sets one matter default and leaves the other out",
            call: () =>
                setOrgMatterDefaults(ORG, { default_working_language: null }),
            url: ORG_PATH,
            method: "PUT",
            body: { default_working_language: null },
        },
        {
            name: "updates a project's jurisdiction profile",
            call: () =>
                updateProject("project-1", {
                    jurisdictions: ["PT", "EU"],
                    governing_law: "PT",
                    working_language: "pt-PT",
                }),
            url: "/api/projects/project-1",
            method: "PATCH",
            body: {
                jurisdictions: ["PT", "EU"],
                governing_law: "PT",
                working_language: "pt-PT",
            },
        },
        {
            name: "clears a project's jurisdiction profile",
            call: () =>
                updateProject("project-1", {
                    jurisdictions: [],
                    governing_law: null,
                    working_language: null,
                }),
            url: "/api/projects/project-1",
            method: "PATCH",
            body: {
                jurisdictions: [],
                governing_law: null,
                working_language: null,
            },
        },
        {
            name: "creates a project with a jurisdiction profile",
            call: () =>
                createProject(
                    "Cross-border sale",
                    undefined,
                    undefined,
                    "org-1",
                    undefined,
                    undefined,
                    { jurisdictions: ["US", "US_NY"], governing_law: "US_NY" },
                ),
            url: "/api/projects",
            method: "POST",
            body: {
                name: "Cross-border sale",
                org_id: "org-1",
                jurisdictions: ["US", "US_NY"],
                governing_law: "US_NY",
            },
        },
        {
            name: "creates a project without one, sending none of its fields",
            call: () => createProject("Plain"),
            url: "/api/projects",
            method: "POST",
            body: { name: "Plain" },
        },
    ])("$name", async ({ call, url, method, body }) => {
        fetchMock.mockResolvedValue(json({}));

        await call();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [requestUrl, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(requestUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        expect(init.body ? JSON.parse(init.body as string) : undefined).toEqual(
            body,
        );
    });

    it("returns the registry as the server sent it", async () => {
        const registry = {
            jurisdictions: [
                {
                    code: "US_CA",
                    name: "California",
                    kind: "subdivision",
                    parent: "US",
                    languages: ["en"],
                },
            ],
            working_languages: [{ code: "en-US", name: "American English" }],
            max_jurisdictions: 10,
        };
        fetchMock.mockResolvedValue(json(registry));
        await expect(getJurisdictionRegistry()).resolves.toEqual(registry);
    });

    it("passes an abort signal through to the registry and defaults reads", async () => {
        fetchMock.mockImplementation(async () => json({}));
        const controller = new AbortController();
        await getJurisdictionRegistry(controller.signal);
        await getOrgMatterDefaults(ORG, controller.signal);
        for (const [, init] of fetchMock.mock.calls as [string, RequestInit][])
            expect(init.signal).toBe(controller.signal);
    });

    it.each([
        ["invalid_jurisdiction", "XX is not a supported jurisdiction."],
        ["too_many_jurisdictions", "Choose at most 10 jurisdictions."],
        [
            "invalid_working_language",
            "Working language must be one of the supported languages.",
        ],
    ])("surfaces the %s refusal with its code and sentence", async (code, detail) => {
        fetchMock.mockResolvedValue(json({ code, detail }, 400));
        const error = await updateProject("project-1", {
            jurisdictions: ["XX"],
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(MikeApiError);
        expect(error).toMatchObject({ status: 400, code, message: detail });
    });

    it("surfaces the organization's forbidden response when a member sets the defaults", async () => {
        fetchMock.mockResolvedValue(
            json({ detail: "Only an organization admin can do that." }, 403),
        );
        await expect(
            setOrgMatterDefaults(ORG, { default_jurisdictions: [] }),
        ).rejects.toMatchObject({
            status: 403,
            message: "Only an organization admin can do that.",
        });
    });
});
