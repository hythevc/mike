import { describe, expect, it } from "vitest";
import {
  diagnosticErrorTags,
  diagnosticEvent,
} from "../observability/sentryPrivacy";
import {
  billingConfiguration,
  configuredFrontendUrl,
  envInt,
  envNonNegativeInt,
  isLiveBillingKey,
  uploadConversionTimeoutMs,
  uploadJobWallClockMs,
  uploadProcessingConfiguration,
  uploadSessionRateLimitConfiguration,
  validateRuntimeConfiguration,
} from "../runtimeConfig";

// A full 40-character commit SHA; the production source offer (AGPL section
// 13) needs it, so a complete production environment carries it.
const VALID_GIT_SHA = "0123456789abcdef0123456789abcdef01234567";

const validProduction = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "service-role-key",
  FRONTEND_URL: "https://app.example.test",
  API_PUBLIC_URL: "https://app.example.test/api",
  GIT_SHA: VALID_GIT_SHA,
} as NodeJS.ProcessEnv;

// A real public repository; the brand default is used unless a test overrides
// it, so the placeholder-repository check does not fire for valid cases.
const REAL_REPOSITORY = "https://github.com/example-org/mike-fork";

describe("runtime authentication configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(() => validateRuntimeConfiguration(validProduction)).not.toThrow();
  });

  it("rejects insecure production callback configuration", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://app.example.test",
        API_PUBLIC_URL: "http://app.example.test/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  // MIKE-BACKEND-2: the backend image defaults NODE_ENV=production, so a bare
  // `docker run` with no public URLs dies here. The message must name the
  // variables AND the switch a local run actually needs.
  it("tells a local run of the production image how to proceed", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: undefined,
        API_PUBLIC_URL: undefined,
      }),
    ).toThrow(
      /FRONTEND_URL is required in production\n- API_PUBLIC_URL is required in production\n\n.*set NODE_ENV=development/s,
    );
  });

  it("does not suggest NODE_ENV when only non-production settings are wrong", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_SECRET_KEY: undefined,
      }),
    ).toThrow(/^(?![\s\S]*NODE_ENV)[\s\S]*SUPABASE_SECRET_KEY is required$/);
  });

  it("does not weaken the https rule for production URLs", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  it("accepts local http URLs outside production", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        NODE_ENV: "development",
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).not.toThrow();
  });

  it("requires a handoff encryption secret when Word auth is enabled", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        WORD_ADDIN_URL: "https://word.example.test",
      }),
    ).toThrow(/AUTH_HANDOFF_ENCRYPTION_SECRET is required/);
  });

  it("accepts the legacy anon key name for the user-session client", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: "legacy-anon-key",
      }),
    ).not.toThrow();
  });

  // AGPL-3.0 section 13: a production build has to be able to offer the exact
  // corresponding source. These checks run only in production.
  it("rejects production boot without a full GIT_SHA, naming the field", () => {
    expect(() =>
      validateRuntimeConfiguration(
        { ...validProduction, GIT_SHA: undefined },
        REAL_REPOSITORY,
      ),
    ).toThrow(/GIT_SHA must be the full 40-character commit/);
  });

  it("rejects a short or malformed GIT_SHA in production", () => {
    expect(() =>
      validateRuntimeConfiguration(
        { ...validProduction, GIT_SHA: "abc123" },
        REAL_REPOSITORY,
      ),
    ).toThrow(/GIT_SHA must be the full 40-character commit/);
    expect(() =>
      validateRuntimeConfiguration(
        // 40 characters but not hex.
        { ...validProduction, GIT_SHA: "z".repeat(40) },
        REAL_REPOSITORY,
      ),
    ).toThrow(/GIT_SHA must be the full 40-character commit/);
  });

  it("rejects a placeholder source repository in production, naming the field", () => {
    expect(() =>
      validateRuntimeConfiguration(
        validProduction,
        "https://github.example.com/org/repo",
      ),
    ).toThrow(/sourceRepositoryUrl .* must name the public source repository/);
    expect(() =>
      validateRuntimeConfiguration(validProduction, "[source repository]"),
    ).toThrow(/sourceRepositoryUrl/);
  });

  it("accepts production boot with a full GIT_SHA and a real repository", () => {
    expect(() =>
      validateRuntimeConfiguration(validProduction, REAL_REPOSITORY),
    ).not.toThrow();
  });

  it("does not require GIT_SHA or a real repository outside production", () => {
    expect(() =>
      validateRuntimeConfiguration(
        {
          ...validProduction,
          NODE_ENV: "development",
          GIT_SHA: undefined,
          FRONTEND_URL: "http://localhost:3000",
          API_PUBLIC_URL: "http://localhost:3000/api",
        },
        "https://example.com/placeholder",
      ),
    ).not.toThrow();
  });
});

// Billing is off by default and never turns on by accident: with it on, a
// live-mode provider key is refused at boot unless a second switch says so.
describe("billing configuration", () => {
  const billingOn = {
    ...validProduction,
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:3000",
    API_PUBLIC_URL: "http://localhost:3000/api",
    BILLING_ENABLED: "true",
    STRIPE_WEBHOOK_SECRET: "whsec_test_placeholder",
  } as NodeJS.ProcessEnv;

  it("is off unless BILLING_ENABLED is exactly true", () => {
    expect(billingConfiguration({}).enabled).toBe(false);
    expect(billingConfiguration({ BILLING_ENABLED: "1" }).enabled).toBe(false);
    expect(billingConfiguration({ BILLING_ENABLED: "yes" }).enabled).toBe(false);
    expect(billingConfiguration({ BILLING_ENABLED: " TRUE " }).enabled).toBe(true);
    expect(billingConfiguration({ BILLING_ENABLED: "true" })).toMatchObject({
      enabled: true,
      allowLive: false,
      provider: "stripe",
      secretKey: "",
      webhookSecret: "",
    });
    expect(billingConfiguration({ BILLING_PROVIDER: "Fake" }).provider).toBe("fake");
    expect(billingConfiguration({ BILLING_PROVIDER: "paypal" }).provider).toBeNull();
  });

  it("recognises live-mode secret and restricted keys", () => {
    expect(isLiveBillingKey("sk_live_placeholder")).toBe(true);
    expect(isLiveBillingKey(" rk_live_placeholder ")).toBe(true);
    expect(isLiveBillingKey("sk_test_placeholder")).toBe(false);
    expect(isLiveBillingKey("rk_test_placeholder")).toBe(false);
    expect(isLiveBillingKey("")).toBe(false);
    expect(isLiveBillingKey(undefined)).toBe(false);
  });

  it("refuses BILLING_ENABLED with a live-mode secret unless BILLING_ALLOW_LIVE is true", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "sk_live_placeholder",
      }),
    ).toThrow(/BILLING_ENABLED is set with a live-mode STRIPE_SECRET_KEY/);
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "rk_live_placeholder",
      }),
    ).toThrow(/live-mode/);
    // Only the exact value counts, so a stray "1" or "yes" does not unlock it.
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "sk_live_placeholder",
        BILLING_ALLOW_LIVE: "1",
      }),
    ).toThrow(/live-mode/);
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "sk_live_placeholder",
        BILLING_ALLOW_LIVE: "true",
      }),
    ).not.toThrow();
  });

  it("accepts a test-mode secret", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "sk_test_placeholder",
      }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "rk_test_placeholder",
      }),
    ).not.toThrow();
  });

  it("requires the provider key and the webhook secret once billing is on", () => {
    expect(() =>
      validateRuntimeConfiguration({ ...billingOn, STRIPE_WEBHOOK_SECRET: undefined }),
    ).toThrow(/STRIPE_SECRET_KEY is required[\s\S]*STRIPE_WEBHOOK_SECRET is required/);
    // The fake provider needs no provider key, only the webhook secret.
    expect(() =>
      validateRuntimeConfiguration({ ...billingOn, BILLING_PROVIDER: "fake" }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        BILLING_PROVIDER: "fake",
        STRIPE_WEBHOOK_SECRET: undefined,
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET is required/);
  });

  it("refuses the fake provider in production and an unknown provider anywhere", () => {
    expect(() =>
      validateRuntimeConfiguration(
        {
          ...validProduction,
          BILLING_ENABLED: "true",
          BILLING_PROVIDER: "fake",
          STRIPE_WEBHOOK_SECRET: "whsec_test_placeholder",
        },
        REAL_REPOSITORY,
      ),
    ).toThrow(/BILLING_PROVIDER=fake is for tests and local stacks only/);
    expect(() =>
      validateRuntimeConfiguration({ ...billingOn, BILLING_PROVIDER: "paypal" }),
    ).toThrow(/BILLING_PROVIDER must be "stripe" or "fake"/);
  });

  it("checks nothing while billing is off, whatever keys are around", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...billingOn,
        BILLING_ENABLED: undefined,
        STRIPE_SECRET_KEY: "sk_live_placeholder",
        STRIPE_WEBHOOK_SECRET: undefined,
        BILLING_PROVIDER: "paypal",
      }),
    ).not.toThrow();
  });

  it("names the billing fields in the diagnostic tags without their values", () => {
    let failure: unknown;
    try {
      validateRuntimeConfiguration({
        ...billingOn,
        STRIPE_SECRET_KEY: "sk_live_PRIVATE",
      });
    } catch (error) {
      failure = error;
    }
    const event = diagnosticEvent({ tags: diagnosticErrorTags(failure) });
    expect(event.tags).toEqual({
      failure_code: "configuration_invalid",
      configuration_fields: "BILLING_ENABLED",
    });
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
  });

  it("builds the web app origin for provider return URLs", () => {
    expect(configuredFrontendUrl({})).toBe("http://localhost:3000");
    expect(configuredFrontendUrl({ FRONTEND_URL: "https://app.example.test/" })).toBe(
      "https://app.example.test",
    );
  });
});

describe("non-negative integer settings", () => {
  // TRUST_PROXY_HOPS=0 is how an API reachable from the internet stops
  // trusting X-Forwarded-For, so it must not turn into the default of 1 the
  // way it does for envInt.
  it("reads 0 as 0, where envInt would fall back", () => {
    const env = { TRUST_PROXY_HOPS: "0" } as NodeJS.ProcessEnv;
    expect(envNonNegativeInt("TRUST_PROXY_HOPS", 1, env)).toBe(0);
    expect(envInt("TRUST_PROXY_HOPS", 1, env)).toBe(1);
  });

  it("reads plain positive integers, ignoring surrounding spaces", () => {
    expect(
      envNonNegativeInt("TRUST_PROXY_HOPS", 1, {
        TRUST_PROXY_HOPS: " 2 ",
      } as NodeJS.ProcessEnv),
    ).toBe(2);
  });

  it.each([undefined, "", "  ", "-1", "1.5", "0x1", "1e2", "2abc", "abc"])(
    "falls back to the default for %j",
    (value) => {
      expect(
        envNonNegativeInt("TRUST_PROXY_HOPS", 1, {
          TRUST_PROXY_HOPS: value,
        } as NodeJS.ProcessEnv),
      ).toBe(1);
    },
  );

  it("falls back for a value too large to count exactly", () => {
    expect(
      envNonNegativeInt("TRUST_PROXY_HOPS", 1, {
        TRUST_PROXY_HOPS: "99999999999999999999",
      } as NodeJS.ProcessEnv),
    ).toBe(1);
  });
});

describe("upload-session rate-limit configuration", () => {
  it("uses safe defaults when overrides are absent or invalid", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "0",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "not-a-number",
      }),
    ).toEqual({
      mutationWindowMinutes: 15,
      mutationMax: 300,
      pollingWindowMinutes: 15,
      pollingMax: 3_000,
      sessionCreationMaxPerHour: 50,
    });
  });

  it("accepts positive environment overrides", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_WINDOW_MINUTES: "10",
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "900",
        RATE_LIMIT_UPLOAD_SESSION_POLL_WINDOW_MINUTES: "20",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "6000",
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "250",
      }),
    ).toEqual({
      mutationWindowMinutes: 10,
      mutationMax: 900,
      pollingWindowMinutes: 20,
      pollingMax: 6_000,
      sessionCreationMaxPerHour: 250,
    });
  });

  it("clamps an hourly creation limit the database cannot represent", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "9999999999",
      }).sessionCreationMaxPerHour,
    ).toBe(1_000_000);
  });
});

describe("upload-processing configuration", () => {
  it("uses an eight-job pool with at most two active jobs per user by default", () => {
    expect(uploadProcessingConfiguration({})).toEqual({
      concurrency: 8,
      maxRunningPerUser: 2,
    });
  });

  it("accepts positive overrides and keeps the per-user cap within the pool", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "8",
        UPLOAD_PROCESSING_MAX_RUNNING_PER_USER: "20",
      }),
    ).toEqual({
      concurrency: 8,
      maxRunningPerUser: 8,
    });
  });

  it("bounds accidental oversized pools", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "1000",
      }),
    ).toEqual({
      concurrency: 64,
      maxRunningPerUser: 2,
    });
  });
});

describe("upload worker deadlines", () => {
  it("uses two-minute conversions and a fifteen-minute job budget by default", () => {
    expect(uploadConversionTimeoutMs({})).toBe(120_000);
    expect(uploadJobWallClockMs({})).toBe(900_000);
  });

  it("accepts overrides inside the supported range", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "45000" }),
    ).toBe(45_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "300000" })).toBe(
      300_000,
    );
  });

  it("clamps overrides that would disable or never reach the deadline", () => {
    expect(uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "1" })).toBe(
      10_000,
    );
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "9999999" }),
    ).toBe(600_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "1" })).toBe(
      60_000,
    );
    expect(
      uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "9999999999" }),
    ).toBe(3_600_000);
  });

  it("falls back to the defaults for unparseable values", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "soon" }),
    ).toBe(120_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "-5" })).toBe(
      900_000,
    );
  });
});

it("identifies invalid configuration fields without sending their values", () => {
  let failure: unknown;
  try {
    validateRuntimeConfiguration({
      NODE_ENV: "production",
      SUPABASE_URL: "PRIVATE_URL",
      SUPABASE_SECRET_KEY: "PRIVATE_KEY",
    });
  } catch (error) {
    failure = error;
  }
  const event = diagnosticEvent({ tags: diagnosticErrorTags(failure) });
  // GIT_SHA joins the set in production: the source offer needs it, and it is
  // a registered configuration field, so its absence is diagnosable too.
  expect(event.tags).toEqual({
    failure_code: "configuration_invalid",
    configuration_fields:
      "API_PUBLIC_URL,FRONTEND_URL,GIT_SHA,SUPABASE_PUBLISHABLE_KEY,SUPABASE_URL",
  });
  expect(JSON.stringify(event)).not.toContain("PRIVATE");
});
