// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { inserts, rpcCalls, control } = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  control: { deploymentTokensUsed: 0 },
}));

// The ledger: this month's deployment-key usage, and the rows written.
vi.mock("../supabase", () => ({
  createServerSupabase: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return {
        data: [
          {
            key_source: "env",
            input_tokens: control.deploymentTokensUsed,
            output_tokens: 0,
          },
        ],
        error: null,
      };
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "usage_events") inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { completeWithProvider, keySourceOf, streamWithProvider } from "./providers";
import { resetModelRegistryCache } from "./registry";
import { runWithUsageContext, type UsageContext } from "./usageContext";
import { DEPLOYMENT_QUOTA_EXCEEDED_CODE, settleUsageWrites } from "../usage";
import type { UserApiKeys } from "./types";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000010";

const personal: UsageContext = {
  userId: USER,
  orgId: null,
  projectId: null,
  surface: "chat",
};

function anthropicMessageResponse() {
  return Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "Answer" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 2 },
  });
}

function chatCompletionResponse() {
  return Response.json({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "local",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Answer" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  });
}

/** The provider: every request that reached it. */
const providerCalls = vi.fn();

const complete = (apiKeys?: UserApiKeys, context: UsageContext = personal) =>
  runWithUsageContext(context, () =>
    completeWithProvider({ model: "claude-haiku-4-5", user: "Hello", apiKeys }),
  );

beforeEach(() => {
  inserts.length = 0;
  rpcCalls.length = 0;
  control.deploymentTokensUsed = 0;
  providerCalls.mockReset();
  providerCalls.mockImplementation(async () => anthropicMessageResponse());
  vi.stubGlobal("fetch", providerCalls);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetModelRegistryCache();
});

describe("the monthly cap on the deployment's keys", () => {
  beforeEach(() => {
    vi.stubEnv("DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP", "1000");
  });

  it("refuses a deployment-key call over the cap before any provider request", async () => {
    control.deploymentTokensUsed = 1000;
    await expect(complete()).rejects.toMatchObject({
      code: DEPLOYMENT_QUOTA_EXCEEDED_CODE,
    });
    await expect(
      runWithUsageContext(personal, () =>
        streamWithProvider({
          model: "claude-haiku-4-5",
          systemPrompt: "s",
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    ).rejects.toMatchObject({ code: DEPLOYMENT_QUOTA_EXCEEDED_CODE });
    expect(providerCalls).not.toHaveBeenCalled();
    await settleUsageWrites();
    expect(inserts).toEqual([]);
  });

  it("counts the workspace the work belongs to", async () => {
    control.deploymentTokensUsed = 1000;
    await expect(complete(undefined, { ...personal, orgId: ORG })).rejects.toThrow(
      /This organization has reached/,
    );
    expect(rpcCalls[0]).toMatchObject({
      name: "usage_monthly_rollup",
      args: { p_org_id: ORG, p_user_id: USER },
    });
  });

  it("lets deployment-key calls through below the cap and records them", async () => {
    control.deploymentTokensUsed = 999;
    await expect(complete()).resolves.toBe("Answer");
    expect(providerCalls).toHaveBeenCalledTimes(1);
    await settleUsageWrites();
    expect(inserts).toEqual([
      expect.objectContaining({
        surface: "chat",
        provider: "claude",
        model: "claude-haiku-4-5",
        key_source: "env",
        input_tokens: 5,
        output_tokens: 2,
      }),
    ]);
  });

  it("treats the environment key the key store hands over as the deployment's", async () => {
    control.deploymentTokensUsed = 5000;
    await expect(
      complete({ claude: "sk-deployment", keySources: { claude: "env" } }),
    ).rejects.toMatchObject({ code: DEPLOYMENT_QUOTA_EXCEEDED_CODE });
    // A saved key that is the deployment's own value spends the deployment's
    // account, whatever layer it came from.
    await expect(
      complete({ claude: "sk-deployment", keySources: { claude: "user" } }),
    ).rejects.toMatchObject({ code: DEPLOYMENT_QUOTA_EXCEEDED_CODE });
    expect(providerCalls).not.toHaveBeenCalled();
  });

  it("still runs a person's own key over the cap, recorded as theirs", async () => {
    control.deploymentTokensUsed = 5000;
    await expect(
      complete({ claude: "sk-person", keySources: { claude: "user" } }),
    ).resolves.toBe("Answer");
    expect(providerCalls).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toEqual([]);
    await settleUsageWrites();
    expect(inserts).toEqual([expect.objectContaining({ key_source: "user" })]);
  });

  it("still runs an organization's key over the cap, recorded as the organization's", async () => {
    control.deploymentTokensUsed = 5000;
    await expect(
      complete(
        { claude: "sk-firm", keySources: { claude: "org" } },
        { ...personal, orgId: ORG },
      ),
    ).resolves.toBe("Answer");
    expect(rpcCalls).toEqual([]);
    await settleUsageWrites();
    expect(inserts).toEqual([
      expect.objectContaining({ key_source: "org", org_id: ORG }),
    ]);
  });
});

describe("without a cap", () => {
  it("blocks nothing and never reads the ledger", async () => {
    control.deploymentTokensUsed = 10_000_000;
    await expect(complete()).resolves.toBe("Answer");
    await expect(
      complete({ claude: "sk-deployment", keySources: { claude: "env" } }),
    ).resolves.toBe("Answer");
    expect(providerCalls).toHaveBeenCalledTimes(2);
    expect(rpcCalls).toEqual([]);
    await settleUsageWrites();
    expect(inserts.map((row) => row.key_source)).toEqual(["env", "env"]);
  });
});

describe("whose key a configured model runs on", () => {
  beforeEach(() => {
    providerCalls.mockImplementation(async () => chatCompletionResponse());
  });

  const run = (model: string, apiKeys?: UserApiKeys) =>
    runWithUsageContext(personal, () =>
      completeWithProvider({ model, user: "Hello", apiKeys }),
    );

  it("is the deployment's for a key from the model registry or a keyless endpoint", async () => {
    vi.stubEnv("LOCAL_MODEL_KEY", "registry-key");
    vi.stubEnv(
      "MIKE_MODEL_CONFIG_JSON",
      JSON.stringify({
        models: [
          {
            id: "registry-model",
            provider: "openai-compatible",
            location: "cloud",
            baseUrl: "https://models.example.test/v1",
            apiKeyEnv: "LOCAL_MODEL_KEY",
          },
          {
            id: "keyless-model",
            provider: "openai-compatible",
            location: "local",
            baseUrl: "http://localhost:8000/v1",
          },
        ],
      }),
    );
    resetModelRegistryCache();
    await run("registry-model");
    await run("keyless-model");
    await settleUsageWrites();
    expect(inserts.map((row) => [row.model, row.key_source])).toEqual([
      ["registry-model", "env"],
      ["keyless-model", "env"],
    ]);
  });

  it("is the person's for their saved key under the model's provider", async () => {
    vi.stubEnv(
      "MIKE_MODEL_CONFIG_JSON",
      JSON.stringify({
        models: [
          {
            id: "byok-model",
            provider: "openai-compatible",
            location: "cloud",
            baseUrl: "https://models.example.test/v1",
            apiKeyProvider: "openai",
          },
        ],
      }),
    );
    resetModelRegistryCache();
    await run("byok-model", { openai: "sk-person", keySources: { openai: "user" } });
    await settleUsageWrites();
    expect(inserts).toEqual([expect.objectContaining({ key_source: "user" })]);
  });
});

describe("keySourceOf", () => {
  it("reads the value first and the key store's record second", () => {
    expect(keySourceOf("claude", "", ["sk-deployment"])).toBe("env");
    expect(keySourceOf("claude", "sk-deployment", ["sk-deployment"])).toBe("env");
    expect(keySourceOf("claude", "sk-person", ["sk-deployment"])).toBe("user");
    expect(
      keySourceOf("claude", "sk-firm", ["sk-deployment"], {
        keySources: { claude: "org" },
      }),
    ).toBe("org");
    expect(
      keySourceOf("bedrock", "aws-key", [null], { keySources: { bedrock: "env" } }),
    ).toBe("env");
  });
});
