import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../db";
import { settings } from "../db/schema";

export type LlmProvider = "anthropic" | "openai";

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  source: "settings" | "env" | "none";
};

export const PROVIDER_DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
};

export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-5"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
};

const SETTING_KEYS = {
  provider: "llm.provider",
  anthropicKey: "llm.anthropic.apiKey",
  anthropicModel: "llm.anthropic.model",
  openaiKey: "llm.openai.apiKey",
  openaiModel: "llm.openai.model",
};

async function readAll(): Promise<Record<string, string>> {
  await migrationsReady;
  const rows = await db.select().from(settings);
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.value != null) out[r.key] = r.value;
  }
  return out;
}

async function writeOne(key: string, value: string | null) {
  await migrationsReady;
  if (value == null) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (existing[0]) {
    await db.update(settings).set({ value }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

export async function getLlmConfig(override?: { kind?: "summary" | "cluster" | "showExport" }): Promise<LlmConfig> {
  void override;
  const all = await readAll();
  const rawProvider = all[SETTING_KEYS.provider];
  const envProvider: LlmProvider = process.env.AI_INTEGRATIONS_OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
    ? "openai"
    : "anthropic";
  const provider: LlmProvider =
    rawProvider === "openai" || rawProvider === "anthropic" ? rawProvider : envProvider;

  if (provider === "openai") {
    const settingsKey = all[SETTING_KEYS.openaiKey] ?? null;
    const envKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
    const apiKey = settingsKey ?? envKey;
    return {
      provider,
      apiKey,
      baseUrl: settingsKey ? null : (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? null),
      model: all[SETTING_KEYS.openaiModel] ?? PROVIDER_DEFAULT_MODEL.openai,
      source: settingsKey ? "settings" : envKey ? "env" : "none",
    };
  }

  const settingsKey = all[SETTING_KEYS.anthropicKey] ?? null;
  const envKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? null;
  const apiKey = settingsKey ?? envKey;
  return {
    provider: "anthropic",
    apiKey,
    baseUrl: settingsKey ? null : (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? null),
    model: all[SETTING_KEYS.anthropicModel] ?? PROVIDER_DEFAULT_MODEL.anthropic,
    source: settingsKey ? "settings" : envKey ? "env" : "none",
  };
}

export type LlmStatus = {
  activeProvider: LlmProvider;
  activeModel: string;
  source: "settings" | "env" | "none";
  hasKey: boolean;
  providers: Record<LlmProvider, { configured: boolean; source: "settings" | "env" | "none"; model: string }>;
  models: Record<LlmProvider, string[]>;
};

export async function getLlmStatus(): Promise<LlmStatus> {
  const all = await readAll();
  const active = await getLlmConfig();
  const providerStatus = (p: LlmProvider) => {
    const settingsKey = p === "anthropic" ? all[SETTING_KEYS.anthropicKey] : all[SETTING_KEYS.openaiKey];
    const envKey =
      p === "anthropic"
        ? process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY
        : process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    const modelKey = p === "anthropic" ? SETTING_KEYS.anthropicModel : SETTING_KEYS.openaiModel;
    return {
      configured: !!(settingsKey || envKey),
      source: (settingsKey ? "settings" : envKey ? "env" : "none") as "settings" | "env" | "none",
      model: all[modelKey] ?? PROVIDER_DEFAULT_MODEL[p],
    };
  };
  return {
    activeProvider: active.provider,
    activeModel: active.model,
    source: active.source,
    hasKey: !!active.apiKey,
    providers: {
      anthropic: providerStatus("anthropic"),
      openai: providerStatus("openai"),
    },
    models: PROVIDER_MODELS,
  };
}

export type SaveLlmSettingsInput = {
  provider?: LlmProvider;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  openaiApiKey?: string | null;
  openaiModel?: string;
};

export async function saveLlmSettings(input: SaveLlmSettingsInput) {
  if (input.provider) {
    if (input.provider !== "anthropic" && input.provider !== "openai") {
      throw new Error("invalid_provider");
    }
    await writeOne(SETTING_KEYS.provider, input.provider);
  }
  if (input.anthropicApiKey !== undefined) {
    const v = input.anthropicApiKey?.trim();
    await writeOne(SETTING_KEYS.anthropicKey, v ? v : null);
  }
  if (input.anthropicModel) {
    await writeOne(SETTING_KEYS.anthropicModel, input.anthropicModel);
  }
  if (input.openaiApiKey !== undefined) {
    const v = input.openaiApiKey?.trim();
    await writeOne(SETTING_KEYS.openaiKey, v ? v : null);
  }
  if (input.openaiModel) {
    await writeOne(SETTING_KEYS.openaiModel, input.openaiModel);
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export type LlmCallOpts = {
  prompt: string;
  maxTokens?: number;
  modelOverride?: string;
};

export async function llmGenerateText(opts: LlmCallOpts): Promise<string> {
  const cfg = await getLlmConfig();
  if (!cfg.apiKey) throw new Error(`llm_not_configured (provider=${cfg.provider})`);
  const model = opts.modelOverride ?? cfg.model;
  const maxTokens = opts.maxTokens ?? 8192;

  if (cfg.provider === "anthropic") {
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    });
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: opts.prompt }],
    });
    const block = resp.content[0];
    return block && block.type === "text" ? block.text : "";
  }

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
  });
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: opts.prompt }],
  });
  return resp.choices[0]?.message?.content ?? "";
}

export async function llmGenerateJson<T = unknown>(opts: LlmCallOpts): Promise<T> {
  const text = await llmGenerateText(opts);
  return JSON.parse(extractJson(text)) as T;
}

export async function llmIsConfigured(): Promise<boolean> {
  const cfg = await getLlmConfig();
  return !!cfg.apiKey;
}
