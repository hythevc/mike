// SPDX-License-Identifier: AGPL-3.0-only
//
// A stateful, in-memory stand-in for the database the request desk talks to,
// shared by the intake unit tests and the /intake route tests.
//
// It supports the PostgREST subset the request desk and the code it calls
// (lib/access, lib/orgAccessOverrides, lib/audit, the projects facade) use,
// and mirrors the request_desk_* functions closely enough to exercise the
// service and route layers: references per organization, the status and
// assignment outcomes, the trail entries they write and the guard trigger's
// refusals. The SQL itself is tested against PostgreSQL in
// src/__tests__/integration/requestDesk.postgres.test.ts; nothing here proves
// a transaction or a lock.

export type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

export type DeskState = {
    tables: Record<string, Row[]>;
    rpcCalls: { fn: string; args: Record<string, unknown> }[];
    /** Make one function fail with this error. */
    rpcErrors: Record<string, DbError>;
    /** Runs before a function executes, to stage a race. */
    beforeRpc: ((fn: string, args: Record<string, unknown>) => void) | null;
    clock: number;
    ids: number;
};

export const desk: DeskState = {
    tables: {},
    rpcCalls: [],
    rpcErrors: {},
    beforeRpc: null,
    clock: 0,
    ids: 0,
};

export const uid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const OPEN = ["new", "in_progress", "waiting"];
const TERMINAL = ["closed", "declined"];
const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** The generated columns of request_desk_requests, and the defaults of request_desk_forms. */
function generate(tableName: string, row: Row): Row {
    if (tableName === "request_desk_requests") {
        row.reference = `REQ-${row.reference_number}`;
        row.priority_rank = PRIORITY_RANK[String(row.priority)] ?? 3;
    }
    if (tableName === "request_desk_forms") {
        row.updated_at ??= row.created_at;
        row.enabled ??= true;
        row.intro ??= "";
        row.privacy_policy_url ??= null;
        row.allowed_sender_domains ??= [];
        row.retention_days ??= 365;
        row.token_rotated_at ??= null;
    }
    return row;
}

function nextId(): string {
    desk.ids += 1;
    return `10000000-0000-4000-8000-${String(desk.ids).padStart(12, "0")}`;
}

function nextTime(): string {
    desk.clock += 1;
    return new Date(Date.UTC(2026, 9, 31, 9, 0, desk.clock)).toISOString();
}

export function table(name: string): Row[] {
    return (desk.tables[name] ??= []);
}

export function resetDesk(tables: Record<string, Row[]> = {}): void {
    desk.tables = structuredClone(tables);
    desk.rpcCalls = [];
    desk.rpcErrors = {};
    desk.beforeRpc = null;
    desk.clock = 0;
    desk.ids = 0;
}

/** A two-org fixture: Firm (team) with an owner, an admin and two members. */
export const PEOPLE = {
    owner: { id: uid(1), email: "owner@firm.example" },
    admin: { id: uid(2), email: "admin@firm.example" },
    member: { id: uid(3), email: "member@firm.example" },
    colleague: { id: uid(4), email: "colleague@firm.example" },
    outsider: { id: uid(5), email: "outsider@other.example" },
} as const;
export const FIRM = uid(10);
export const OTHER_ORG = uid(11);
export const PERSONAL_ORG = uid(12);

export function seedFirm(): void {
    resetDesk({
        organizations: [
            { id: FIRM, name: "Firm", kind: "team", deleted_at: null },
            { id: OTHER_ORG, name: "Other", kind: "team", deleted_at: null },
            {
                id: PERSONAL_ORG,
                name: "Personal",
                kind: "personal",
                personal_user_id: PEOPLE.member.id,
                deleted_at: null,
            },
        ],
        org_members: [
            { org_id: FIRM, user_id: PEOPLE.owner.id, role: "owner" },
            { org_id: FIRM, user_id: PEOPLE.admin.id, role: "admin" },
            { org_id: FIRM, user_id: PEOPLE.member.id, role: "member" },
            { org_id: FIRM, user_id: PEOPLE.colleague.id, role: "member" },
            { org_id: OTHER_ORG, user_id: PEOPLE.outsider.id, role: "owner" },
            { org_id: PERSONAL_ORG, user_id: PEOPLE.member.id, role: "owner" },
        ],
        user_profiles: Object.values(PEOPLE).map((person, index) => ({
            user_id: person.id,
            email: person.email,
            display_name: `Person ${index + 1}`,
        })),
    });
}

// ---------------------------------------------------------------------------
// PostgREST subset
// ---------------------------------------------------------------------------

type Filter = (row: Row) => boolean;

/** `organizations.deleted_at` on an org_members read: the embedded org's. */
function columnValue(tableName: string, row: Row, column: string): unknown {
    if (!column.includes(".")) return row[column];
    const [relation, field] = column.split(".");
    if (relation === "organizations") {
        const org = table("organizations").find((o) => o.id === row.org_id);
        return org ? (org[field] ?? null) : undefined;
    }
    throw new Error(`deskDbFake: unsupported embedded filter ${tableName}.${column}`);
}

function compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return a < b ? -1 : 1;
}

function query(tableName: string) {
    const filters: Filter[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let from = 0;
    let to = Number.POSITIVE_INFINITY;
    let wantCount = false;

    const matching = () => table(tableName).filter((row) => filters.every((f) => f(row)));

    function execute(): { data: Row[] | null; error: DbError | null; count?: number } {
        if (op === "insert") {
            const rows = (Array.isArray(payload) ? payload : [payload as Row]).map((row) =>
                generate(tableName, {
                    id: nextId(),
                    created_at: nextTime(),
                    ...row,
                }),
            );
            table(tableName).push(...rows);
            return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (op === "update") {
            const rows = matching();
            for (const row of rows) generate(tableName, Object.assign(row, payload as Row));
            return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (op === "delete") {
            const rows = matching();
            desk.tables[tableName] = table(tableName).filter((row) => !rows.includes(row));
            return { data: rows, error: null };
        }
        const rows = [...matching()].sort((a, b) => {
            for (const order of orders) {
                const result = compare(a[order.column], b[order.column]);
                if (result !== 0) return order.ascending ? result : -result;
            }
            return 0;
        });
        return {
            data: rows.slice(from, to + 1).map((row) => ({ ...row })),
            error: null,
            ...(wantCount ? { count: rows.length } : {}),
        };
    }

    const builder: Record<string, unknown> = {
        select: (_columns?: string, options?: { count?: string }) => {
            if (options?.count) wantCount = true;
            return builder;
        },
        insert: (value: Row | Row[]) => {
            op = "insert";
            payload = value;
            return builder;
        },
        update: (value: Row) => {
            op = "update";
            payload = value;
            return builder;
        },
        delete: () => {
            op = "delete";
            return builder;
        },
        eq: (column: string, value: unknown) => {
            filters.push((row) => columnValue(tableName, row, column) === value);
            return builder;
        },
        neq: (column: string, value: unknown) => {
            filters.push((row) => columnValue(tableName, row, column) !== value);
            return builder;
        },
        is: (column: string, value: unknown) => {
            filters.push((row) => (columnValue(tableName, row, column) ?? null) === value);
            return builder;
        },
        in: (column: string, values: unknown[]) => {
            filters.push((row) => values.includes(columnValue(tableName, row, column)));
            return builder;
        },
        lt: (column: string, value: string) => {
            filters.push((row) => typeof row[column] === "string" && (row[column] as string) < value);
            return builder;
        },
        lte: (column: string, value: string) => {
            filters.push((row) => typeof row[column] === "string" && (row[column] as string) <= value);
            return builder;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
            orders.push({ column, ascending: options?.ascending !== false });
            return builder;
        },
        range: (start: number, end: number) => {
            from = start;
            to = end;
            return builder;
        },
        limit: (n: number) => {
            to = from + n - 1;
            return builder;
        },
        maybeSingle: async () => {
            const result = execute();
            return { data: result.data?.[0] ?? null, error: result.error };
        },
        single: async () => {
            const result = execute();
            return result.data?.length
                ? { data: result.data[0], error: null }
                : { data: null, error: result.error ?? { code: "PGRST116", message: "no rows" } };
        },
        then: (
            resolve: (value: unknown) => unknown,
            reject?: (error: unknown) => unknown,
        ) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
}

// ---------------------------------------------------------------------------
// The request desk functions, as the migration defines them
// ---------------------------------------------------------------------------

function checkViolation(message: string): { data: null; error: DbError } {
    return { data: null, error: { code: "23514", message } };
}

function isMember(orgId: unknown, userId: unknown): boolean {
    return table("org_members").some((m) => m.org_id === orgId && m.user_id === userId);
}

function lockRequest(args: Record<string, unknown>): Row | undefined {
    return table("request_desk_requests").find(
        (row) => row.id === args.p_request_id && row.org_id === args.p_org_id,
    );
}

function comment(fields: Row): Row {
    const row: Row = {
        id: nextId(),
        author_user_id: null,
        body: "",
        from_status: null,
        to_status: null,
        event: null,
        subject_user_id: null,
        created_at: nextTime(),
        ...fields,
    };
    table("request_desk_comments").push(row);
    return { ...row };
}

const FUNCTIONS: Record<string, (args: Record<string, unknown>) => { data: unknown; error: DbError | null }> = {
    request_desk_create_request(args) {
        const org = table("organizations").find((o) => o.id === args.p_org_id);
        if (!org || org.kind !== "team" || org.deleted_at)
            return checkViolation("request desk: requests belong to an active team organization");
        if (args.p_assignee_user_id && !isMember(args.p_org_id, args.p_assignee_user_id))
            return checkViolation("request desk: the assignee is not a member of the organization");
        const counter = table("request_desk_counters").find((c) => c.org_id === args.p_org_id);
        const number = counter ? (counter.last_number as number) + 1 : 1;
        if (counter) counter.last_number = number;
        else table("request_desk_counters").push({ org_id: args.p_org_id, last_number: 1 });
        const at = nextTime();
        const row: Row = {
            id: nextId(),
            org_id: args.p_org_id,
            reference_number: number,
            reference: `REQ-${number}`,
            title: String(args.p_title).trim(),
            details: args.p_details ?? "",
            request_type: args.p_request_type ?? null,
            status: "new",
            priority: args.p_priority ?? "normal",
            source: args.p_source ?? "internal",
            requester_name: args.p_requester_name ?? null,
            requester_email: args.p_requester_email ?? null,
            assignee_user_id: args.p_assignee_user_id ?? null,
            project_id: null,
            created_by: args.p_created_by ?? null,
            sla_due_at: args.p_sla_due_at ?? null,
            closed_at: null,
            created_at: at,
            updated_at: at,
        };
        table("request_desk_requests").push(generate("request_desk_requests", row));
        if (row.assignee_user_id)
            comment({
                request_id: row.id,
                org_id: row.org_id,
                author_user_id: row.created_by,
                kind: "system",
                event: "assigned",
                subject_user_id: row.assignee_user_id,
            });
        return { data: { ...row }, error: null };
    },
    request_desk_change_status(args) {
        const current = lockRequest(args);
        if (!current) return { data: { outcome: "not_found" }, error: null };
        if (args.p_expected_status && current.status !== args.p_expected_status)
            return { data: { outcome: "conflict", request: { ...current } }, error: null };
        if (current.status === args.p_status)
            return { data: { outcome: "unchanged", request: { ...current } }, error: null };
        const from = current.status;
        current.closed_at = !TERMINAL.includes(String(args.p_status))
            ? null
            : TERMINAL.includes(String(from))
              ? current.closed_at
              : nextTime();
        current.status = args.p_status;
        current.updated_at = nextTime();
        const entry = comment({
            request_id: current.id,
            org_id: current.org_id,
            author_user_id: args.p_actor_id,
            kind: "status_change",
            body: typeof args.p_note === "string" ? args.p_note.trim() : "",
            from_status: from,
            to_status: args.p_status,
        });
        return { data: { outcome: "changed", request: { ...current }, comment: entry }, error: null };
    },
    request_desk_assign(args) {
        const current = lockRequest(args);
        if (!current) return { data: { outcome: "not_found" }, error: null };
        if (args.p_only_if_unassigned && current.assignee_user_id)
            return { data: { outcome: "conflict", request: { ...current } }, error: null };
        if ((current.assignee_user_id ?? null) === (args.p_assignee_user_id ?? null))
            return { data: { outcome: "unchanged", request: { ...current } }, error: null };
        if (args.p_assignee_user_id && !isMember(current.org_id, args.p_assignee_user_id))
            return checkViolation("request desk: the assignee is not a member of the organization");
        const previous = current.assignee_user_id;
        current.assignee_user_id = args.p_assignee_user_id ?? null;
        current.updated_at = nextTime();
        const entry = comment({
            request_id: current.id,
            org_id: current.org_id,
            author_user_id: args.p_actor_id,
            kind: "system",
            event: args.p_assignee_user_id ? "assigned" : "unassigned",
            subject_user_id: args.p_assignee_user_id ?? previous,
        });
        return { data: { outcome: "changed", request: { ...current }, comment: entry }, error: null };
    },
    request_desk_link_matter(args) {
        const current = lockRequest(args);
        if (!current) return { data: { outcome: "not_found" }, error: null };
        if (current.project_id)
            return { data: { outcome: "conflict", request: { ...current } }, error: null };
        const project = table("projects").find((p) => p.id === args.p_project_id);
        if (!project || project.org_id !== current.org_id)
            return checkViolation("request desk: the matter belongs to another workspace");
        current.project_id = args.p_project_id;
        current.updated_at = nextTime();
        const entry = comment({
            request_id: current.id,
            org_id: current.org_id,
            author_user_id: args.p_actor_id,
            kind: "system",
            event: "matter_created",
        });
        return { data: { outcome: "changed", request: { ...current }, comment: entry }, error: null };
    },
    // A public form submission: the request through request_desk_create_request
    // with source 'form' and no creator, linked to its form. A form that is
    // disabled or gone is refused the way the SQL function refuses it.
    request_desk_submit_form_request(args) {
        const form = table("request_desk_forms").find(
            (f) => f.id === args.p_form_id && f.enabled === true,
        );
        if (!form) return checkViolation("request desk: the form is not available");
        const created = FUNCTIONS.request_desk_create_request({
            p_org_id: form.org_id,
            p_created_by: null,
            p_source: "form",
            p_title: args.p_title,
            p_details: args.p_details,
            p_request_type: null,
            p_priority: "normal",
            p_requester_name: args.p_requester_name,
            p_requester_email: args.p_requester_email,
            p_assignee_user_id: null,
            p_sla_due_at: null,
        });
        if (created.error) return created;
        const row = table("request_desk_requests").find(
            (r) => r.id === (created.data as Row).id,
        )!;
        row.form_id = args.p_form_id;
        return { data: { ...row }, error: null };
    },
    // Retention: unconverted form submissions older than their form's
    // retention_days (365 without a form), oldest first, at most p_limit.
    request_desk_delete_expired_form_submissions(args) {
        const limit = Math.max(Number(args.p_limit ?? 500), 1);
        const now = Date.now();
        const forms = table("request_desk_forms");
        const expired = table("request_desk_requests")
            .filter((r) => {
                if (r.source !== "form" || r.project_id) return false;
                const form = forms.find((f) => f.id === r.form_id);
                const days = Number(form?.retention_days ?? 365);
                return Date.parse(String(r.created_at)) < now - days * 86_400_000;
            })
            .sort((a, b) => compare(a.created_at, b.created_at))
            .slice(0, limit);
        const ids = new Set(expired.map((r) => r.id));
        desk.tables.request_desk_requests = table("request_desk_requests").filter(
            (r) => !ids.has(r.id),
        );
        desk.tables.request_desk_comments = table("request_desk_comments").filter(
            (c) => !ids.has(c.request_id),
        );
        return { data: ids.size, error: null };
    },
    request_desk_board_summary(args) {
        const rows = table("request_desk_requests").filter((r) => r.org_id === args.p_org_id);
        const open = rows.filter((r) => OPEN.includes(String(r.status)));
        const now = new Date().toISOString();
        const countBy = (list: Row[], key: string, values: string[]) =>
            Object.fromEntries(values.map((v) => [v, list.filter((r) => r[key] === v).length]));
        return {
            data: {
                total: rows.length,
                open: open.length,
                overdue: open.filter((r) => typeof r.sla_due_at === "string" && r.sla_due_at < now).length,
                unassigned: open.filter((r) => !r.assignee_user_id).length,
                assigned_to_me: open.filter((r) => r.assignee_user_id === args.p_user_id).length,
                by_status: countBy(rows, "status", [...OPEN, ...TERMINAL]),
                open_by_priority: countBy(open, "priority", ["low", "normal", "high", "urgent"]),
            },
            error: null,
        };
    },
    // The projects facade's create, as far as createProject needs it.
    create_project_with_memory(args) {
        const at = nextTime();
        const row: Row = {
            id: nextId(),
            user_id: args.p_user_id,
            name: args.p_name,
            cm_number: args.p_cm_number ?? null,
            practice: args.p_practice ?? null,
            org_id: args.p_org_id ?? null,
            visibility: "private",
            archived_at: null,
            created_at: at,
            updated_at: at,
        };
        table("projects").push(row);
        return { data: [{ ...row }], error: null };
    },
    // Access helpers the project checks consult.
    org_item_is_ownerless: () => ({ data: false, error: null }),
    org_private_access_role: () => ({ data: null, error: null }),
};

export function deskClient() {
    return {
        from: (name: string) => query(name),
        rpc: (fn: string, args: Record<string, unknown> = {}) => {
            desk.rpcCalls.push({ fn, args });
            desk.beforeRpc?.(fn, args);
            if (desk.rpcErrors[fn])
                return Promise.resolve({ data: null, error: desk.rpcErrors[fn] });
            const run = FUNCTIONS[fn];
            return Promise.resolve(run ? run(args) : { data: null, error: null });
        },
    };
}

/** The audit rows written so far. */
export function auditRows(): Row[] {
    return table("audit_events");
}
