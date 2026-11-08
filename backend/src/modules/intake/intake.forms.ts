// SPDX-License-Identifier: AGPL-3.0-only
//
// Request desk: public request forms.
//
// A form is a link an organization hands to people without a seat (a firm's
// company clients, an in-house team's business colleagues). Whoever opens the
// link sees the organization's name, its notices and a short form, and gets
// back a reference and nothing else: no AI runs inside a submission, and a
// requester never sees AI output. Lawyers pick the request up on the board.
//
// The link token is random, shown once to the owner or admin who creates or
// rotates the form, and stored only as a SHA-256 digest, so a database read
// never yields a working link. Unknown, disabled and rotated tokens all get
// one identical "not found", so a link cannot be probed for its state.
//
// Abuse handling lives here and in app.ts: a dedicated public rate-limit
// lane runs before any lookup; a hidden honeypot field returns a fake
// success and writes nothing; every field has a length cap; and a form can
// restrict senders to approved email domains.
//
// Database objects: request_desk_forms, request_desk_requests.form_id,
// request_desk_submit_form_request (20261108_50_request_desk_forms.sql).

import { createHash, randomBytes, randomInt } from "node:crypto";
import type {
    RequestDeskForm,
    RequestDeskFormLink,
    RequestDeskFormReceipt,
    RequestDeskPublicForm,
} from "@mike/contracts";
import { getOrgRole, isOrgAdmin, type OrgRole } from "../../lib/access";
import { AppError } from "../../lib/appError";
import { recordAudit } from "../../lib/audit";
import {
    failure,
    internalFailure,
    ok,
    type ServiceFailure,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import {
    EMAIL_PATTERN,
    INTAKE_AUDIT_SURFACE,
    asRecord,
    firstRow,
    loadPeople,
    recordRequestDeskAudit,
    resolveRequestDeskOrg,
    type Parsed,
    type RequestDeskAuditAction,
    type RequestDeskCaller,
    type RequestRow,
} from "./intake.shared";

// ---------------------------------------------------------------------------
// Codes and copy
// ---------------------------------------------------------------------------

// Codes a client acts on. Each one is listed in CODE_KINDS
// (frontend/src/shared/lib/userError.ts).
export const REQUEST_FORM_NOT_FOUND = "request_form_not_found";
export const REQUEST_FORM_ADMIN_ONLY = "request_form_admin_only";
export const REQUEST_FORM_SENDER_NOT_ALLOWED = "request_form_sender_not_allowed";

/** The one answer for an unknown, disabled or rotated link. */
export const FORM_NOT_FOUND_DETAIL = "This request form is not available.";
const ADMIN_ONLY_DETAIL =
    "Only the organization's owners and admins manage request forms.";
const SENDER_NOT_ALLOWED_DETAIL =
    "This form only accepts requests from approved email domains. Use your work email address.";

/** Where the web app serves a form: this path followed by the token. */
export const FORM_LINK_PREFIX = "/request/";

export const DEFAULT_FORM_TITLE = "Legal request";

/** The notices a new form starts with; each organization edits the wording. */
export const DEFAULT_FORM_DISCLAIMER =
    "Submitting this form sends your request to the legal team. It does not create a lawyer-client relationship, and nothing on this page is legal advice. A person will reply to you outside this page.";

export function defaultPrivacyNotice(organizationName: string): string {
    return `${organizationName} controls the personal data you enter here and uses it to handle your request.`;
}

// Length caps. The request desk's own caps apply to the title (200) and the
// requester's name (200) and email (320); a public submission's details are
// capped tighter than a member's 20,000.
const TITLE_MAX = 120;
const NOTICE_MAX = 2000;
const URL_MAX = 500;
const DOMAINS_MAX = 50;
const RETENTION_MIN_DAYS = 1;
const RETENTION_MAX_DAYS = 3650;
const DEFAULT_RETENTION_DAYS = 365;
const SUBMISSION_TITLE_MAX = 200;
const SUBMISSION_DETAILS_MAX = 10000;
const SUBMISSION_NAME_MAX = 200;
const SUBMISSION_EMAIL_MAX = 320;

/** The hidden field a form shows only to robots; a person never fills it. */
export const HONEYPOT_FIELD = "website";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** 256 random bits, URL-safe. Shown once; only its digest is stored. */
export function generateFormToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashFormToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** What a token looks like; anything else is never hashed or looked up. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

export function isPlausibleFormToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_SHAPE.test(value);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type FormRow = {
    id: string;
    org_id: string;
    created_by: string | null;
    enabled: boolean;
    title: string;
    intro: string;
    disclaimer: string;
    privacy_notice: string;
    privacy_policy_url: string | null;
    allowed_sender_domains: string[];
    retention_days: number;
    token_rotated_at: string | null;
    created_at: string;
    updated_at: string;
};

/** Everything but token_hash, which never leaves the database. */
export const FORM_COLUMNS =
    "id, org_id, created_by, enabled, title, intro, disclaimer, privacy_notice, privacy_policy_url, allowed_sender_domains, retention_days, token_rotated_at, created_at, updated_at";

function notFound(): ServiceFailure {
    return failure("not_found", FORM_NOT_FOUND_DETAIL, REQUEST_FORM_NOT_FOUND);
}

function adminOnly(): ServiceFailure {
    return failure("forbidden", ADMIN_ONLY_DETAIL, REQUEST_FORM_ADMIN_ONLY);
}

async function serializeForms(
    db: Db,
    rows: FormRow[],
): Promise<ServiceResult<RequestDeskForm[]>> {
    const people = await loadPeople(
        db,
        rows.map((row) => ({ orgId: row.org_id, userId: row.created_by })),
    );
    if (!people.ok) return people;
    return ok(
        rows.map((row) => ({
            id: row.id,
            org_id: row.org_id,
            title: row.title,
            intro: row.intro ?? "",
            disclaimer: row.disclaimer,
            privacy_notice: row.privacy_notice,
            privacy_policy_url: row.privacy_policy_url ?? null,
            allowed_sender_domains: [...(row.allowed_sender_domains ?? [])],
            retention_days: Number(row.retention_days),
            enabled: row.enabled === true,
            created_by: row.created_by
                ? (people.data.get(`${row.org_id}:${row.created_by}`) ?? {
                      user_id: row.created_by,
                      email: null,
                      display_name: null,
                      is_member: false,
                  })
                : null,
            token_rotated_at: row.token_rotated_at ?? null,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })),
    );
}

async function serializeForm(db: Db, row: FormRow): Promise<ServiceResult<RequestDeskForm>> {
    const forms = await serializeForms(db, [row]);
    if (!forms.ok) return forms;
    return ok(forms.data[0]);
}

function linkFor(form: RequestDeskForm, token: string): RequestDeskFormLink {
    return { form, token, path: `${FORM_LINK_PREFIX}${token}` };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

type FormFields = {
    title: string;
    intro: string;
    disclaimer: string;
    privacy_notice: string;
    privacy_policy_url: string | null;
    allowed_sender_domains: string[];
    retention_days: number;
    enabled: boolean;
};

const absent = (value: unknown) =>
    value === undefined || value === null || value === "";

/** Multi-line notice text, trimmed at both ends. Empty means "not given". */
function parseNotice(value: unknown, field: string): Parsed<string | null> {
    if (absent(value)) return { ok: true, value: null };
    if (typeof value !== "string") return { ok: false, detail: `${field} must be text` };
    const text = value.trim();
    if (!text) return { ok: true, value: null };
    if (text.length > NOTICE_MAX)
        return { ok: false, detail: `${field} must be at most ${NOTICE_MAX} characters` };
    return { ok: true, value: text };
}

function parseFormTitle(value: unknown): Parsed<string | null> {
    if (absent(value)) return { ok: true, value: null };
    if (typeof value !== "string") return { ok: false, detail: "title must be text" };
    const title = value.trim();
    if (!title) return { ok: true, value: null };
    if (title.length > TITLE_MAX)
        return { ok: false, detail: `title must be at most ${TITLE_MAX} characters` };
    return { ok: true, value: title };
}

export function parsePrivacyPolicyUrl(value: unknown): Parsed<string | null> {
    if (absent(value)) return { ok: true, value: null };
    if (typeof value !== "string")
        return { ok: false, detail: "privacy_policy_url must be text" };
    const text = value.trim();
    if (!text) return { ok: true, value: null };
    const invalid = {
        ok: false,
        detail: "privacy_policy_url must be a web address starting with https:// or http://",
    } as const;
    if (text.length > URL_MAX || !/^https?:\/\//i.test(text)) return invalid;
    try {
        const url = new URL(text);
        if (!url.hostname) return invalid;
    } catch {
        return invalid;
    }
    return { ok: true, value: text };
}

const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Sender domains, as a list or one text separated by commas, spaces or line
 * breaks. Lower-cased, a leading "@" dropped, duplicates removed.
 */
export function parseSenderDomains(value: unknown): Parsed<string[]> {
    if (absent(value)) return { ok: true, value: [] };
    const parts = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/[\s,;]+/)
          : null;
    if (!parts || parts.some((part) => typeof part !== "string"))
        return { ok: false, detail: "allowed_sender_domains must be a list of domains" };
    const domains = [
        ...new Set(
            (parts as string[])
                .map((part) => part.trim().toLowerCase().replace(/^@/, ""))
                .filter(Boolean),
        ),
    ];
    if (domains.length > DOMAINS_MAX)
        return { ok: false, detail: `allowed_sender_domains must list at most ${DOMAINS_MAX} domains` };
    const bad = domains.find((domain) => !DOMAIN_SHAPE.test(domain));
    if (bad !== undefined)
        return { ok: false, detail: `allowed_sender_domains must be domains such as example.com` };
    return { ok: true, value: domains };
}

export function parseRetentionDays(value: unknown): Parsed<number | null> {
    if (absent(value)) return { ok: true, value: null };
    const number = typeof value === "string" ? Number(value) : value;
    if (
        typeof number !== "number" ||
        !Number.isInteger(number) ||
        number < RETENTION_MIN_DAYS ||
        number > RETENTION_MAX_DAYS
    )
        return {
            ok: false,
            detail: `retention_days must be a whole number of days between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS}`,
        };
    return { ok: true, value: number };
}

function parseEnabled(value: unknown): Parsed<boolean | null> {
    if (value === undefined || value === null) return { ok: true, value: null };
    if (typeof value !== "boolean") return { ok: false, detail: "enabled must be true or false" };
    return { ok: true, value };
}

/**
 * The fields of a form as an owner or admin sets them. On creation, a notice
 * that is left out gets its default; on an edit, a notice cannot be emptied,
 * only reworded, so the page always carries one.
 */
function parseFormFields(
    body: Record<string, unknown>,
    mode: { kind: "create"; organizationName: string } | { kind: "update" },
): Parsed<Partial<FormFields>> {
    const fields: Partial<FormFields> = {};
    const has = (key: keyof FormFields) => mode.kind === "create" || Object.hasOwn(body, key);

    if (has("title")) {
        const title = parseFormTitle(body.title);
        if (!title.ok) return title;
        if (title.value !== null) fields.title = title.value;
        else if (mode.kind === "create") fields.title = DEFAULT_FORM_TITLE;
        else return { ok: false, detail: "title is required" };
    }
    if (has("intro")) {
        const intro = parseNotice(body.intro, "intro");
        if (!intro.ok) return intro;
        fields.intro = intro.value ?? "";
    }
    if (has("disclaimer")) {
        const disclaimer = parseNotice(body.disclaimer, "disclaimer");
        if (!disclaimer.ok) return disclaimer;
        if (disclaimer.value !== null) fields.disclaimer = disclaimer.value;
        else if (mode.kind === "create") fields.disclaimer = DEFAULT_FORM_DISCLAIMER;
        else
            return {
                ok: false,
                detail: "The disclaimer is required: edit its wording rather than removing it",
            };
    }
    if (has("privacy_notice")) {
        const notice = parseNotice(body.privacy_notice, "privacy_notice");
        if (!notice.ok) return notice;
        if (notice.value !== null) fields.privacy_notice = notice.value;
        else if (mode.kind === "create")
            fields.privacy_notice = defaultPrivacyNotice(mode.organizationName);
        else
            return {
                ok: false,
                detail: "The privacy notice is required: edit its wording rather than removing it",
            };
    }
    if (has("privacy_policy_url")) {
        const url = parsePrivacyPolicyUrl(body.privacy_policy_url);
        if (!url.ok) return url;
        fields.privacy_policy_url = url.value;
    }
    if (has("allowed_sender_domains")) {
        const domains = parseSenderDomains(body.allowed_sender_domains);
        if (!domains.ok) return domains;
        fields.allowed_sender_domains = domains.value;
    }
    if (has("retention_days")) {
        const retention = parseRetentionDays(body.retention_days);
        if (!retention.ok) return retention;
        fields.retention_days =
            retention.value ?? (mode.kind === "create" ? DEFAULT_RETENTION_DAYS : undefined);
        if (fields.retention_days === undefined)
            return { ok: false, detail: "retention_days is required" };
    }
    if (has("enabled")) {
        const enabled = parseEnabled(body.enabled);
        if (!enabled.ok) return enabled;
        if (enabled.value !== null) fields.enabled = enabled.value;
        else if (mode.kind === "create") fields.enabled = true;
        else return { ok: false, detail: "enabled must be true or false" };
    }
    return { ok: true, value: fields };
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

type LoadedForm = { form: FormRow; orgRole: OrgRole };

/**
 * One form, for an owner or admin of its organization. A non-member gets
 * "not found", so a form id cannot be probed; a member gets "forbidden".
 */
async function loadFormForAdmin(
    db: Db,
    formId: string,
    caller: RequestDeskCaller,
): Promise<ServiceResult<LoadedForm>> {
    if (!isUuid(formId)) return failure("not_found", "Request form not found");
    const { data, error } = await db
        .from("request_desk_forms")
        .select(FORM_COLUMNS)
        .eq("id", formId)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", "Request form not found");
    const form = data as unknown as FormRow;
    const orgRole = await getOrgRole(caller.userId, form.org_id, db);
    if (!orgRole) return failure("not_found", "Request form not found");
    if (!isOrgAdmin(orgRole)) return adminOnly();
    return ok({ form, orgRole });
}

function auditForm(
    db: Db,
    caller: RequestDeskCaller,
    form: Pick<FormRow, "id" | "org_id">,
    action: RequestDeskAuditAction,
): Promise<void> {
    return recordRequestDeskAudit(db, {
        caller,
        orgId: form.org_id,
        action,
        ids: { form_id: form.id },
    });
}

// ---------------------------------------------------------------------------
// Owners and admins: list, create, edit, rotate
// ---------------------------------------------------------------------------

export async function listRequestForms(
    db: Db,
    args: RequestDeskCaller & { workspace: unknown },
): Promise<ServiceResult<{ forms: RequestDeskForm[] }>> {
    const scope = await resolveRequestDeskOrg(db, args.userId, args.workspace);
    if (!scope.ok) return scope;
    if (!isOrgAdmin(scope.data.orgRole)) return adminOnly();
    const { data, error } = await db
        .from("request_desk_forms")
        .select(FORM_COLUMNS)
        .eq("org_id", scope.data.orgId)
        .order("created_at", { ascending: false });
    if (error) return internalFailure(error);
    const forms = await serializeForms(db, (data ?? []) as unknown as FormRow[]);
    if (!forms.ok) return forms;
    return ok({ forms: forms.data });
}

/**
 * Create a form for an organization. The token is returned this once; the
 * row keeps only its digest. Notices that are left out get their defaults,
 * the privacy notice naming the organization.
 */
export async function createRequestForm(
    db: Db,
    args: RequestDeskCaller & { body: unknown },
): Promise<ServiceResult<RequestDeskFormLink>> {
    const body = asRecord(args.body);
    const scope = await resolveRequestDeskOrg(db, args.userId, body.org_id);
    if (!scope.ok) return scope;
    if (!isOrgAdmin(scope.data.orgRole)) return adminOnly();

    const organization = await db
        .from("organizations")
        .select("id, name")
        .eq("id", scope.data.orgId)
        .maybeSingle();
    if (organization.error) return internalFailure(organization.error);
    const organizationName =
        (organization.data as { name?: string } | null)?.name?.trim() || "The organization";

    const parsed = parseFormFields(body, { kind: "create", organizationName });
    if (!parsed.ok) return failure("validation", parsed.detail);
    const fields = parsed.value as FormFields;

    const token = generateFormToken();
    const { data, error } = await db
        .from("request_desk_forms")
        .insert({
            org_id: scope.data.orgId,
            created_by: args.userId,
            token_hash: hashFormToken(token),
            ...fields,
        })
        .select(FORM_COLUMNS)
        .single();
    if (error) return internalFailure(error);
    const row = data as unknown as FormRow;

    await auditForm(db, args, row, "request.form_created");
    const form = await serializeForm(db, row);
    if (!form.ok) return form;
    return ok(linkFor(form.data, token));
}

/** Edit a form's notices and settings, or switch it off and on. */
export async function updateRequestForm(
    db: Db,
    args: RequestDeskCaller & { formId: string; body: unknown },
): Promise<ServiceResult<RequestDeskForm>> {
    const loaded = await loadFormForAdmin(db, args.formId, args);
    if (!loaded.ok) return loaded;
    const { form } = loaded.data;

    const body = asRecord(args.body);
    const parsed = parseFormFields(body, { kind: "update" });
    if (!parsed.ok) return failure("validation", parsed.detail);
    const keys = Object.keys(parsed.value) as (keyof FormFields)[];
    if (keys.length === 0) return failure("validation", "Nothing to update");

    const { data, error } = await db
        .from("request_desk_forms")
        .update({ ...parsed.value, updated_at: new Date().toISOString() })
        .eq("id", form.id)
        .eq("org_id", form.org_id)
        .select(FORM_COLUMNS)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", "Request form not found");
    const updated = data as unknown as FormRow;

    const enabledChanged =
        parsed.value.enabled !== undefined && parsed.value.enabled !== form.enabled;
    if (enabledChanged)
        await auditForm(
            db,
            args,
            form,
            parsed.value.enabled ? "request.form_enabled" : "request.form_disabled",
        );
    if (keys.some((key) => key !== "enabled"))
        await auditForm(db, args, form, "request.form_updated");

    return serializeForm(db, updated);
}

/**
 * Replace a form's link. The old token stops matching at once, so a link
 * that leaked or went to the wrong people is dead; the new one is shown this
 * once.
 */
export async function rotateRequestFormLink(
    db: Db,
    args: RequestDeskCaller & { formId: string },
): Promise<ServiceResult<RequestDeskFormLink>> {
    const loaded = await loadFormForAdmin(db, args.formId, args);
    if (!loaded.ok) return loaded;
    const { form } = loaded.data;

    const token = generateFormToken();
    const now = new Date().toISOString();
    const { data, error } = await db
        .from("request_desk_forms")
        .update({ token_hash: hashFormToken(token), token_rotated_at: now, updated_at: now })
        .eq("id", form.id)
        .eq("org_id", form.org_id)
        .select(FORM_COLUMNS)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", "Request form not found");

    await auditForm(db, args, form, "request.form_link_rotated");
    const serialized = await serializeForm(db, data as unknown as FormRow);
    if (!serialized.ok) return serialized;
    return ok(linkFor(serialized.data, token));
}

// ---------------------------------------------------------------------------
// The public side: read a form by its link, submit through it
// ---------------------------------------------------------------------------

type PublicForm = { form: FormRow; organization: { id: string; name: string } };

/**
 * The enabled form a token names, in an active team organization. Every
 * other case (a malformed token, an unknown or rotated one, a disabled form,
 * a deleted organization) is the same not-found.
 */
async function loadPublicForm(db: Db, rawToken: unknown): Promise<ServiceResult<PublicForm>> {
    if (!isPlausibleFormToken(rawToken)) return notFound();
    const { data, error } = await db
        .from("request_desk_forms")
        .select(FORM_COLUMNS)
        .eq("token_hash", hashFormToken(rawToken))
        .eq("enabled", true)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return notFound();
    const form = data as unknown as FormRow;

    const organization = await db
        .from("organizations")
        .select("id, name, kind, deleted_at")
        .eq("id", form.org_id)
        .maybeSingle();
    if (organization.error) return internalFailure(organization.error);
    const org = organization.data as {
        id: string;
        name: string;
        kind?: string;
        deleted_at?: string | null;
    } | null;
    if (!org || org.kind !== "team" || org.deleted_at) return notFound();
    return ok({ form, organization: { id: org.id, name: org.name } });
}

export async function getPublicRequestForm(
    db: Db,
    args: { token: unknown },
): Promise<ServiceResult<RequestDeskPublicForm>> {
    const loaded = await loadPublicForm(db, args.token);
    if (!loaded.ok) return loaded;
    const { form, organization } = loaded.data;

    const logo = await db
        .from("org_logos")
        .select("content_type, data_base64")
        .eq("org_id", organization.id)
        .maybeSingle();
    if (logo.error) return internalFailure(logo.error);
    const image = logo.data as { content_type?: string; data_base64?: string } | null;

    return ok({
        organization: {
            name: organization.name,
            logo_data_url:
                image?.content_type && image.data_base64
                    ? `data:${image.content_type};base64,${image.data_base64}`
                    : null,
        },
        title: form.title,
        intro: form.intro ?? "",
        disclaimer: form.disclaimer,
        privacy_notice: form.privacy_notice,
        privacy_policy_url: form.privacy_policy_url ?? null,
        retention_days: Number(form.retention_days),
        restricts_sender_domains: (form.allowed_sender_domains ?? []).length > 0,
    });
}

type Submission = {
    title: string;
    details: string;
    requester_name: string;
    requester_email: string;
};

function requiredText(
    value: unknown,
    max: number,
    missing: string,
    tooLong: string,
): Parsed<string> {
    if (typeof value !== "string" || !value.trim()) return { ok: false, detail: missing };
    const text = value.trim();
    if (text.length > max) return { ok: false, detail: tooLong };
    return { ok: true, value: text };
}

/** A requester's submission. The messages are shown beside the public form. */
export function parseSubmission(body: Record<string, unknown>): Parsed<Submission> {
    const title = requiredText(
        body.title,
        SUBMISSION_TITLE_MAX,
        "Add a short title for your request.",
        `Keep the title to ${SUBMISSION_TITLE_MAX} characters.`,
    );
    if (!title.ok) return title;
    const details = requiredText(
        body.details,
        SUBMISSION_DETAILS_MAX,
        "Describe what you need.",
        `Keep the details to ${SUBMISSION_DETAILS_MAX.toLocaleString("en-US")} characters.`,
    );
    if (!details.ok) return details;
    const name = requiredText(
        body.requester_name,
        SUBMISSION_NAME_MAX,
        "Add your name.",
        `Keep your name to ${SUBMISSION_NAME_MAX} characters.`,
    );
    if (!name.ok) return name;
    const email = requiredText(
        body.requester_email,
        SUBMISSION_EMAIL_MAX,
        "Add the email address the legal team should reply to.",
        `Keep the email address to ${SUBMISSION_EMAIL_MAX} characters.`,
    );
    if (!email.ok) return email;
    if (!EMAIL_PATTERN.test(email.value))
        return { ok: false, detail: "Enter a valid email address." };
    return {
        ok: true,
        value: {
            title: title.value,
            details: details.value,
            requester_name: name.value,
            requester_email: email.value.toLowerCase(),
        },
    };
}

/** Whether an address may submit: its domain, or a parent of it, is listed. */
export function senderDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
    if (allowedDomains.length === 0) return true;
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    return allowedDomains.some(
        (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
    );
}

/** A robot that filled the hidden field is told it succeeded. */
function decoyReference(): string {
    return `REQ-${randomInt(100, 10000)}`;
}

/**
 * A submission through a form. Writes one request (source 'form', no
 * creator) and one ids-only audit row with no actor, and answers with the
 * reference alone. Nothing here calls a model.
 */
export async function submitPublicRequestForm(
    db: Db,
    args: { token: unknown; body: unknown },
): Promise<ServiceResult<RequestDeskFormReceipt>> {
    const loaded = await loadPublicForm(db, args.token);
    if (!loaded.ok) return loaded;
    const { form } = loaded.data;

    const body = asRecord(args.body);
    const honeypot = body[HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.trim()) {
        return ok({ reference: decoyReference() });
    }

    const parsed = parseSubmission(body);
    if (!parsed.ok) return failure("validation", parsed.detail);
    const submission = parsed.value;
    if (!senderDomainAllowed(submission.requester_email, form.allowed_sender_domains ?? []))
        return failure("validation", SENDER_NOT_ALLOWED_DETAIL, REQUEST_FORM_SENDER_NOT_ALLOWED);

    const { data, error } = await db.rpc("request_desk_submit_form_request", {
        p_form_id: form.id,
        p_title: submission.title,
        p_details: submission.details,
        p_requester_name: submission.requester_name,
        p_requester_email: submission.requester_email,
    });
    // The function refuses a form disabled between the lookup and the insert
    // with a check_violation; to the requester that is the same not-found.
    if (error) return (error as { code?: unknown }).code === "23514" ? notFound() : internalFailure(error);
    const row = firstRow<RequestRow>(data);
    if (!row)
        return internalFailure(
            new AppError(
                "request_desk.form_submit_failed",
                "request_desk_submit_form_request returned no row",
            ),
        );

    // Ids only, and no actor: the requester has no account.
    await recordAudit(db, {
        userId: null,
        orgId: form.org_id,
        action: "request.form_submitted" satisfies RequestDeskAuditAction,
        surface: INTAKE_AUDIT_SURFACE,
        detail: { form_id: form.id, request_id: row.id },
    });

    return ok({ reference: row.reference });
}
