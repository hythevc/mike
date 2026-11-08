// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MikeApiError,
    createRequestForm,
    getPublicRequestForm,
    listRequestForms,
    rotateRequestFormLink,
    submitPublicRequestForm,
    updateRequestForm,
} from "./mikeApi";

const fetchMock = vi.fn();
const ORG = "11111111-1111-4111-8111-111111111111";
const FORM = "form/one?two";
const FORM_PATH = "/api/intake/forms/form%2Fone%3Ftwo";
const TOKEN = "tok_en/with?chars";
const TOKEN_PATH = "/api/request-forms/tok_en%2Fwith%3Fchars";

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

describe("request form API requests", () => {
    it.each([
        {
            name: "list",
            call: () => listRequestForms(ORG),
            url: `/api/intake/forms?workspace=${ORG}`,
            method: "GET",
            body: undefined,
        },
        {
            name: "create",
            call: () => createRequestForm(ORG, { title: "Legal request", retention_days: 90 }),
            url: "/api/intake/forms",
            method: "POST",
            body: { title: "Legal request", retention_days: 90, org_id: ORG },
        },
        {
            name: "create with defaults",
            call: () => createRequestForm(ORG),
            url: "/api/intake/forms",
            method: "POST",
            body: { org_id: ORG },
        },
        {
            name: "update",
            call: () => updateRequestForm(FORM, { enabled: false }),
            url: FORM_PATH,
            method: "PATCH",
            body: { enabled: false },
        },
        {
            name: "rotate",
            call: () => rotateRequestFormLink(FORM),
            url: `${FORM_PATH}/rotate`,
            method: "POST",
            body: undefined,
        },
        {
            name: "public read",
            call: () => getPublicRequestForm(TOKEN),
            url: TOKEN_PATH,
            method: "GET",
            body: undefined,
        },
        {
            name: "public submit",
            call: () =>
                submitPublicRequestForm(TOKEN, {
                    title: "NDA",
                    details: "Please review.",
                    requester_name: "Dana",
                    requester_email: "dana@acme.example",
                    website: "",
                }),
            url: `${TOKEN_PATH}/submit`,
            method: "POST",
            body: {
                title: "NDA",
                details: "Please review.",
                requester_name: "Dana",
                requester_email: "dana@acme.example",
                website: "",
            },
        },
    ])("sends $name to the gateway", async ({ call, url, method, body }) => {
        fetchMock.mockResolvedValueOnce(json({ ok: true }));
        await call();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe(method);
        expect(init.credentials).toBe("include");
        if (body === undefined) expect(init.body).toBeUndefined();
        else expect(JSON.parse(init.body as string)).toEqual(body);
    });

    it("returns the parsed answer", async () => {
        fetchMock.mockResolvedValueOnce(json({ reference: "REQ-7" }, 201));
        await expect(
            submitPublicRequestForm(TOKEN, {
                title: "NDA",
                details: "Please review.",
                requester_name: "Dana",
                requester_email: "dana@acme.example",
            }),
        ).resolves.toEqual({ reference: "REQ-7" });
    });

    it("surfaces the one not-found answer with its code", async () => {
        fetchMock.mockResolvedValueOnce(
            json(
                { code: "request_form_not_found", detail: "This request form is not available." },
                404,
            ),
        );
        const failure = await getPublicRequestForm(TOKEN).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(MikeApiError);
        expect(failure).toMatchObject({
            status: 404,
            code: "request_form_not_found",
            message: "This request form is not available.",
        });
    });
});
