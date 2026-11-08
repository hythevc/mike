// SPDX-License-Identifier: AGPL-3.0-only
//
// Hosted provider pages for an organization's owners: a checkout for one of
// the catalog's plans, and the billing portal (payment method, invoices,
// cancellation). Neither touches org_subscriptions: the provider's webhook
// does, once it has confirmed what happened (billing.webhooks.ts).
//
// With billing off both answer not_found, before any role check and before
// any provider is constructed: the surface does not exist on such a
// deployment.

import type { Db } from "../../lib/supabase";
import {
    failure,
    internalFailure,
    ok,
    type ServiceFailure,
    type ServiceResult,
} from "../../lib/serviceResult";
import { getOrgRole, isOrgOwner } from "../../lib/access";
import { isPersonalOrg } from "../../lib/personalOrgs";
import { planByKey, plansEnabled } from "../../lib/planCatalog";
import { readSubscriptionRefs } from "../../lib/entitlements";
import { recordAudit } from "../../lib/audit";
import {
    billingConfiguration,
    configuredFrontendUrl,
} from "../../lib/runtimeConfig";
import { safeError } from "../../lib/safeError";
import {
    BillingProviderError,
    type BillingProvider,
    type HostedSession,
} from "./billing.provider";
import { resolveBillingProvider } from "./billing.registry";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OwnerRequest = {
    orgId: string;
    userId: string;
    env?: NodeJS.ProcessEnv;
    /** The adapter to use; tests pass one, production resolves the configured one. */
    provider?: BillingProvider;
};

/** With billing off, no /billing surface exists: 404, never 403 or 401. */
function billingOff(): ServiceFailure {
    return failure("not_found", "Not found");
}

/**
 * Only an owner of a team organization may start a checkout or open the
 * portal. A non-member learns nothing (404), as everywhere else in the
 * organization API; a member or admin is told it is an owner's decision.
 */
async function authorizeOwner(
    db: Db,
    input: { orgId: string; userId: string },
): Promise<ServiceFailure | null> {
    if (!UUID_RE.test(input.orgId))
        return failure("not_found", "Organization not found");
    if (await isPersonalOrg(db, input.orgId))
        return failure("not_found", "Organization not found");
    const role = await getOrgRole(input.userId, input.orgId, db);
    if (!role) return failure("not_found", "Organization not found");
    if (!isOrgOwner(role))
        return failure(
            "forbidden",
            "Only an organization owner can change its plan or billing.",
        );
    return null;
}

function providerFor(
    env: NodeJS.ProcessEnv,
    provider: BillingProvider | undefined,
): BillingProvider | ServiceFailure {
    try {
        return provider ?? resolveBillingProvider(billingConfiguration(env));
    } catch (error) {
        if (error instanceof BillingProviderError)
            return failure("unavailable", "Billing is not configured on this deployment.");
        throw error;
    }
}

function isFailure(value: BillingProvider | ServiceFailure): value is ServiceFailure {
    return "ok" in value && value.ok === false;
}

/** Where the provider sends the browser afterwards: the organization's plan page. */
export function billingReturnUrls(env: NodeJS.ProcessEnv, orgId: string): {
    success: string;
    cancel: string;
    portalReturn: string;
} {
    const page = `${configuredFrontendUrl(env)}/organizations/${encodeURIComponent(orgId)}/settings/plan`;
    return {
        success: `${page}?checkout=success`,
        cancel: `${page}?checkout=canceled`,
        portalReturn: page,
    };
}

/** A provider call that failed: the status is logged, the person is told to retry. */
function providerFailure(
    what: "checkout" | "portal",
    error: unknown,
): ServiceFailure {
    if (error instanceof BillingProviderError) {
        console.error(`[billing] ${what} session failed`, {
            status: error.status,
            ...safeError(error.cause ?? error),
        });
        return failure(
            "unavailable",
            "The billing provider could not be reached. Try again in a moment.",
        );
    }
    return internalFailure(error);
}

/**
 * Start a hosted checkout for a plan from the catalog. The plan must be on
 * offer and carry a provider price; a workspace that already has a live
 * subscription is sent to the portal instead, so a second checkout can
 * never stack a second subscription on the same organization.
 */
export async function createCheckoutSession(
    db: Db,
    input: OwnerRequest & { userEmail: string | null; planKey: unknown },
): Promise<ServiceResult<HostedSession>> {
    const env = input.env ?? process.env;
    if (!billingConfiguration(env).enabled) return billingOff();
    const denied = await authorizeOwner(db, input);
    if (denied) return denied;
    if (!plansEnabled(env))
        return failure(
            "conflict",
            "Plans are not enabled on this deployment, so there is no plan to buy.",
        );

    const planKey = typeof input.planKey === "string" ? input.planKey.trim() : "";
    const plan = planKey ? planByKey(planKey, env) : null;
    if (!plan || !plan.public)
        return failure("validation", "Choose one of the plans on offer.");
    if (!plan.providerPriceRef)
        return failure("validation", "This plan cannot be bought online yet.");

    const current = await readSubscriptionRefs(db, input.orgId);
    if (current?.status === "active" && current.subscriptionRef)
        return failure(
            "conflict",
            "This organization already has a subscription. Use Manage billing to change it.",
        );

    const provider = providerFor(env, input.provider);
    if (isFailure(provider)) return provider;
    const urls = billingReturnUrls(env, input.orgId);
    let session: HostedSession;
    try {
        session = await provider.createCheckoutSession({
            orgId: input.orgId,
            planKey: plan.key,
            priceRef: plan.providerPriceRef,
            customerRef: current?.customerRef ?? null,
            // The email only prefills a customer the provider has yet to create.
            customerEmail: current?.customerRef ? null : input.userEmail,
            successUrl: urls.success,
            cancelUrl: urls.cancel,
        });
    } catch (error) {
        return providerFailure("checkout", error);
    }
    await recordAudit(db, {
        userId: input.userId,
        orgId: input.orgId,
        action: "billing.checkout_started",
        title: plan.name,
        surface: "organization",
        detail: { plan_key: plan.key },
    });
    return ok(session);
}

/**
 * Open the provider's billing portal for the organization's customer. There
 * is no customer until a first checkout has completed, so until then the
 * portal has nothing to show and the request is refused with a plain line.
 */
export async function createPortalSession(
    db: Db,
    input: OwnerRequest,
): Promise<ServiceResult<HostedSession>> {
    const env = input.env ?? process.env;
    if (!billingConfiguration(env).enabled) return billingOff();
    const denied = await authorizeOwner(db, input);
    if (denied) return denied;

    const current = await readSubscriptionRefs(db, input.orgId);
    if (!current?.customerRef)
        return failure(
            "conflict",
            "This organization has no billing account yet. Choose a plan first.",
        );

    const provider = providerFor(env, input.provider);
    if (isFailure(provider)) return provider;
    let session: HostedSession;
    try {
        session = await provider.createPortalSession({
            customerRef: current.customerRef,
            returnUrl: billingReturnUrls(env, input.orgId).portalReturn,
        });
    } catch (error) {
        return providerFailure("portal", error);
    }
    await recordAudit(db, {
        userId: input.userId,
        orgId: input.orgId,
        action: "billing.portal_opened",
        surface: "organization",
    });
    return ok(session);
}
