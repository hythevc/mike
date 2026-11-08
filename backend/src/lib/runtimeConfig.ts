import { brand } from "./brand.generated";

function required(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function envInt(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Like envInt, for a setting where 0 is a real choice rather than "unset".
 * Only plain digits count: an empty, negative, fractional or otherwise
 * malformed value falls back instead of being read as some other number.
 */
export function envNonNegativeInt(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

// The hourly session ceiling is passed straight into a PostgreSQL integer
// argument, so an oversized override would turn every session create into a
// numeric-overflow failure rather than a looser limit.
const MAX_UPLOAD_SESSIONS_PER_HOUR = 1_000_000;

export function uploadSessionRateLimitConfiguration(
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    mutationWindowMinutes: envInt(
      "RATE_LIMIT_UPLOAD_SESSION_MUTATION_WINDOW_MINUTES",
      15,
      env,
    ),
    mutationMax: envInt("RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX", 300, env),
    pollingWindowMinutes: envInt(
      "RATE_LIMIT_UPLOAD_SESSION_POLL_WINDOW_MINUTES",
      15,
      env,
    ),
    pollingMax: envInt("RATE_LIMIT_UPLOAD_SESSION_POLL_MAX", 3_000, env),
    sessionCreationMaxPerHour: clamp(
      envInt("RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR", 50, env),
      1,
      MAX_UPLOAD_SESSIONS_PER_HOUR,
    ),
  };
}

export function uploadProcessingConfiguration(
  env: NodeJS.ProcessEnv = process.env,
) {
  const concurrency = Math.min(
    envInt("UPLOAD_PROCESSING_CONCURRENCY", 8, env),
    64,
  );
  return {
    concurrency,
    maxRunningPerUser: Math.min(
      envInt("UPLOAD_PROCESSING_MAX_RUNNING_PER_USER", 2, env),
      concurrency,
    ),
  };
}

/**
 * Hard deadline for one LibreOffice conversion. A wedged `soffice` child would
 * otherwise hold its worker slot for the life of the process.
 */
export function uploadConversionTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return clamp(
    envInt("UPLOAD_CONVERT_TIMEOUT_MS", 120_000, env),
    10_000,
    600_000,
  );
}

/**
 * Wall-clock budget for one upload job. Past this point the worker stops
 * renewing its lease so another worker can steal and retry the job.
 */
export function uploadJobWallClockMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return clamp(
    envInt("UPLOAD_JOB_WALL_CLOCK_MS", 15 * 60_000, env),
    60_000,
    60 * 60_000,
  );
}

/**
 * Deadlines for one server-owned SSE run (chat, project chat, Word chat,
 * tabular generation). `idleMs` aborts a run that has produced no output for
 * that long (a hung provider or tool). Model progress and data frames re-arm
 * it, but transport keep-alives do not. `maxMs` is a wall-clock
 * backstop for a run that never stops emitting.
 */
export function streamRunDeadlines(env: NodeJS.ProcessEnv = process.env): {
  idleMs: number;
  maxMs: number;
} {
  return {
    idleMs: clamp(
      envInt("STREAM_IDLE_TIMEOUT_MS", 5 * 60_000, env),
      30_000,
      60 * 60_000,
    ),
    maxMs: clamp(
      envInt("STREAM_MAX_LIFETIME_MS", 4 * 60 * 60_000, env),
      60_000,
      24 * 60 * 60_000,
    ),
  };
}

/**
 * Silence limits applied to each raw provider response by providerDeadlines.
 * `firstChunkMs` includes waiting for headers and the first output of a step.
 * `chunkMs` bounds gaps after text, reasoning, tool input or a tool call.
 * Provider clocks end with the provider step, excluding local tool execution;
 * `streamRunDeadlines` stays as the run-level backstop.
 */
export function streamChunkTimeouts(env: NodeJS.ProcessEnv = process.env): {
  firstChunkMs: number;
  chunkMs: number;
} {
  return {
    firstChunkMs: clamp(
      envInt("STREAM_FIRST_CHUNK_TIMEOUT_MS", 2 * 60_000, env),
      10_000,
      30 * 60_000,
    ),
    chunkMs: clamp(
      envInt("STREAM_CHUNK_TIMEOUT_MS", 60_000, env),
      5_000,
      30 * 60_000,
    ),
  };
}

function parsedUrl(value: string, name: string, errors: string[]): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${name} must use http or https`);
      return null;
    }
    return url;
  } catch {
    errors.push(`${name} must be an absolute URL`);
    return null;
  }
}

function requireHttps(url: URL | null, name: string, errors: string[]) {
  if (url && url.protocol !== "https:") {
    errors.push(`${name} must use https in production`);
  }
}

export function supabaseSessionConfiguration(
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    url: required(env, ["SUPABASE_URL"]),
    key: required(env, ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]),
  };
}

export function configuredApiPublicUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return required(env, ["API_PUBLIC_URL"]).replace(/\/+$/, "");
}

/**
 * The browser-reachable web app origin, without a trailing slash: where a
 * flow that leaves the app (a payment provider's hosted page) sends the
 * person back. Production requires FRONTEND_URL (checked below); a local run
 * defaults to the dev server, the same default lib/origins.ts allows.
 */
export function configuredFrontendUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.FRONTEND_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

// ---------------------------------------------------------------------------
// Billing (BILLING_ENABLED). Off by default and never switched on by a code
// change: the adapter in modules/billing is inert, and every /billing route
// answers 404, until an operator sets BILLING_ENABLED=true. Even then a
// live-mode provider key is refused at boot unless BILLING_ALLOW_LIVE is set
// as well, so a deployment cannot start charging by mistake. docs/billing.md
// describes the switches; this file only reads them.
// ---------------------------------------------------------------------------

/** Which billing adapter to construct: the provider over REST, or the in-process fake for tests. */
export type BillingProviderKind = "stripe" | "fake";

export type BillingConfiguration = {
  /** BILLING_ENABLED is exactly "true" (trimmed, any case). */
  enabled: boolean;
  /** BILLING_ALLOW_LIVE is "true": a live-mode key may be used. Unset by default. */
  allowLive: boolean;
  /** The adapter named by BILLING_PROVIDER (default stripe), or null for an unknown value. */
  provider: BillingProviderKind | null;
  /** The provider's secret API key (STRIPE_SECRET_KEY), or "". */
  secretKey: string;
  /** The webhook signing secret (STRIPE_WEBHOOK_SECRET), or "". */
  webhookSecret: string;
};

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name]?.trim().toLowerCase() === "true";
}

/** Whether billing routes exist on this deployment. Off unless explicitly set. */
export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flag(env, "BILLING_ENABLED");
}

/**
 * A live-mode provider secret: one that would move real money. Stripe's
 * secret keys are `sk_live_…` and its restricted keys `rk_live_…`; test-mode
 * keys read `sk_test_…` / `rk_test_…`.
 */
export function isLiveBillingKey(key: string | null | undefined): boolean {
  return /^(?:sk|rk)_live_/i.test(key?.trim() ?? "");
}

export function billingConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): BillingConfiguration {
  const providerSetting = env.BILLING_PROVIDER?.trim().toLowerCase() || "stripe";
  return {
    enabled: billingEnabled(env),
    allowLive: flag(env, "BILLING_ALLOW_LIVE"),
    provider:
      providerSetting === "stripe" || providerSetting === "fake"
        ? providerSetting
        : null,
    secretKey: env.STRIPE_SECRET_KEY?.trim() ?? "",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
  };
}

/**
 * The boot-time rules for billing, as error lines. Nothing is checked while
 * billing is off: the keys are then unused, and a self-hosted deployment that
 * never bills must not have to think about them.
 */
function billingConfigurationErrors(env: NodeJS.ProcessEnv): string[] {
  const billing = billingConfiguration(env);
  if (!billing.enabled) return [];
  const errors: string[] = [];
  if (!billing.provider) {
    errors.push('BILLING_PROVIDER must be "stripe" or "fake"');
  }
  if (billing.provider === "fake" && env.NODE_ENV === "production") {
    errors.push(
      "BILLING_PROVIDER=fake is for tests and local stacks only, not for production",
    );
  }
  if (billing.provider === "stripe" && !billing.secretKey) {
    errors.push("STRIPE_SECRET_KEY is required when BILLING_ENABLED is true");
  }
  if (billing.provider && !billing.webhookSecret) {
    errors.push(
      "STRIPE_WEBHOOK_SECRET is required when BILLING_ENABLED is true",
    );
  }
  // The one rule that matters most: a live key never boots by accident. The
  // switch that allows it is separate from the one that turns billing on, so
  // enabling billing against a copied production key still stops here.
  if (
    billing.provider === "stripe" &&
    isLiveBillingKey(billing.secretKey) &&
    !billing.allowLive
  ) {
    errors.push(
      "BILLING_ENABLED is set with a live-mode STRIPE_SECRET_KEY (sk_live_ or rk_live_); " +
        "this deployment runs billing in test mode only unless BILLING_ALLOW_LIVE=true is also set",
    );
  }
  return errors;
}

export function authHandoffEncryptionSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.AUTH_HANDOFF_ENCRYPTION_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error(
      "AUTH_HANDOFF_ENCRYPTION_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

/** A full 40-character git commit SHA, lower-case hex. */
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Whether a source-repository URL is still a placeholder rather than a real
 * public repository. The AGPL-3.0 section 13 source offer must point at the
 * actual corresponding source, so a production build may not ship with the
 * example.com-style value the brand configuration carries before a fork fills
 * it in. A bracketed value, an example/localhost host, or an unparseable URL
 * all count as unset.
 */
function isPlaceholderRepositoryUrl(url: string | null | undefined): boolean {
  const value = url?.trim() ?? "";
  if (!value) return true;
  if (/[[\]<>]/.test(value)) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "example.com" ||
      host === "example.org" ||
      host === "example.net" ||
      host.endsWith(".example.com") ||
      host.endsWith(".example.org") ||
      host.endsWith(".example.net")
    );
  } catch {
    return true;
  }
}

/**
 * Fail before the HTTP listener starts when the authentication boundary is not
 * usable. This deliberately lives outside app.ts so unit tests can import the
 * Express app without supplying production credentials.
 *
 * `sourceRepositoryUrl` defaults to the brand configuration's value; it is a
 * parameter so a test can exercise the production placeholder-repository check
 * without rebuilding the generated brand module.
 */
export function validateRuntimeConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  sourceRepositoryUrl: string = brand.sourceRepositoryUrl,
): void {
  const errors: string[] = [];
  const session = supabaseSessionConfiguration(env);

  if (!session.url) errors.push("SUPABASE_URL is required");
  if (!session.key) {
    errors.push("SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) is required");
  }
  if (!env.SUPABASE_SECRET_KEY?.trim()) {
    errors.push("SUPABASE_SECRET_KEY is required");
  }

  if (session.url) parsedUrl(session.url, "SUPABASE_URL", errors);

  if (env.AUTH_HANDOFF_ENCRYPTION_SECRET?.trim()) {
    if (env.AUTH_HANDOFF_ENCRYPTION_SECRET.trim().length < 32) {
      errors.push(
        "AUTH_HANDOFF_ENCRYPTION_SECRET must contain at least 32 characters",
      );
    }
  } else if (env.WORD_ADDIN_URL?.trim()) {
    errors.push(
      "AUTH_HANDOFF_ENCRYPTION_SECRET is required when WORD_ADDIN_URL is set",
    );
  }

  // Billing's rules apply in every environment: a live key is refused in a
  // local run as firmly as in production.
  errors.push(...billingConfigurationErrors(env));

  const errorsBeforeProductionChecks = errors.length;
  if (env.NODE_ENV === "production") {
    const frontend = env.FRONTEND_URL?.trim();
    if (!frontend) {
      errors.push("FRONTEND_URL is required in production");
    } else {
      requireHttps(
        parsedUrl(frontend, "FRONTEND_URL", errors),
        "FRONTEND_URL",
        errors,
      );
    }

    const publicApi = configuredApiPublicUrl(env);
    if (!publicApi) {
      errors.push("API_PUBLIC_URL is required in production");
    } else {
      requireHttps(
        parsedUrl(publicApi, "API_PUBLIC_URL", errors),
        "API_PUBLIC_URL",
        errors,
      );
    }

    const wordAddin = env.WORD_ADDIN_URL?.trim();
    if (wordAddin) {
      requireHttps(
        parsedUrl(wordAddin, "WORD_ADDIN_URL", errors),
        "WORD_ADDIN_URL",
        errors,
      );
    }

    // AGPL-3.0 section 13: a production build must be able to point network
    // users at the exact corresponding source. GIT_SHA is the commit the
    // image was built from, and the source offer links to the repository at
    // that commit, so a short, missing or malformed value is a boot failure.
    if (!FULL_GIT_SHA.test(env.GIT_SHA?.trim().toLowerCase() ?? "")) {
      errors.push(
        "GIT_SHA must be the full 40-character commit the running image was built from",
      );
    }
    // The offer is useless if the repository it names is still a placeholder.
    if (isPlaceholderRepositoryUrl(sourceRepositoryUrl)) {
      errors.push(
        "sourceRepositoryUrl in the brand configuration must name the public source repository, not a placeholder",
      );
    }
  }

  if (errors.length > 0) {
    // The backend image sets NODE_ENV=production so that a real deployment
    // can never boot with insecure cookies by omission. Someone who runs that
    // image outside docker compose on their own machine hits these public-URL rules
    // first, so say which switch they are actually looking for.
    const hint =
      errors.length > errorsBeforeProductionChecks
        ? "\n\nNODE_ENV=production requires the public https URLs above " +
          "(FRONTEND_URL, API_PUBLIC_URL, and WORD_ADDIN_URL when set), a " +
          "full 40-character GIT_SHA, and a real source repository URL in " +
          "the brand configuration. For a local run over http, set " +
          "NODE_ENV=development instead; docker compose does this by " +
          "default. See docs/deployment.md."
        : "";
    throw Object.assign(
      new Error(
        `Backend authentication configuration is invalid:\n- ${errors.join("\n- ")}${hint}`,
      ),
      {
        code: "configuration_invalid",
        // Field names only: never configuration values or validation prose.
        configurationFields: [
          ...new Set(
            errors.map((issue) => issue.match(/^[A-Z_]+/)?.[0]).filter(Boolean),
          ),
        ],
      },
    );
  }
}
