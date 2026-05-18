/**
 * Google Gemini generateContent (non-streaming), server-side only.
 *
 * Env:
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (default: gemini-3-flash-preview)
 * - LLM_TIMEOUT_SECONDS (default: 45)
 * - LLM_MAX_RETRIES (default: 1) — extra attempts after empty / parse failures
 * - GEMINI_MAX_ATTEMPTS (default: 8) — hard cap per call (includes 429 retries)
 */

export type AIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIClientConfig = {
  apiKey?: string;
  /** Gemini model id, e.g. gemini-3-flash-preview */
  deployment?: string;
  /** Default request timeout in seconds */
  timeoutSeconds?: number;
  /** Extra attempts after the first (same semantics: total = maxRetries + 1) */
  maxRetries?: number;
};

export type AIRequestOptions = {
  signal?: AbortSignal;
  /** Prepended as a system instruction before the conversation */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-call overrides */
  apiKey?: string;
  deployment?: string;
  timeoutSeconds?: number;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; code?: number };
};

function getGeminiGenerateUrl(model: string): string {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  return `${base}/models/${encodeURIComponent(model)}:generateContent`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After can be seconds (number) or HTTP-date. */
function parseRetryAfterMs(response: Response): number | null {
  const ra = response.headers.get("retry-after");
  if (!ra) return null;
  const asSec = parseInt(ra.trim(), 10);
  if (Number.isFinite(asSec) && asSec >= 0) return asSec * 1000;
  const asDate = Date.parse(ra);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function truncateForError(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/** Gemini REST errors use `{ error: { message, status, code } }`. */
function formatGeminiHttpError(status: number, rawBody: string): string {
  const trimmed = truncateForError(rawBody, 1200);
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string; status?: string; code?: number };
    };
    const msg = parsed.error?.message?.trim();
    const st = parsed.error?.status;
    if (msg) {
      const prefix = st ? `${st} (${status}): ` : `HTTP ${status}: `;
      return prefix + msg;
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${status} – ${trimmed}`;
}

function forbiddenHint(status: number): string {
  if (status !== 403) return "";
  return (
    " For server-side Next.js, use a key without “HTTP referrer” restrictions, " +
    "or restrict by server IP. Enable “Generative Language API” for the key’s project."
  );
}

function chatMessagesToGeminiPayload(
  messages: AIChatMessage[],
  temperature: number,
  maxOutputTokens: number
): Record<string, unknown> {
  const systemTexts: string[] = [];
  const contents: Array<{ role: string; parts: { text: string }[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: m.content }] });
  }
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: Math.min(maxOutputTokens, 8192),
    },
  };
  if (systemTexts.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemTexts.join("\n\n") }],
    };
  }
  return body;
}

function extractGeminiText(data: GeminiGenerateContentResponse): string {
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts?.length) return "";
  return parts.map((p) => p.text ?? "").join("").trim();
}

export class AIClient {
  private readonly geminiApiKey: string;
  private readonly geminiModel: string;
  private readonly timeoutSeconds: number;
  private readonly maxRetries: number;
  private readonly maxAttemptsPerCall: number;

  constructor(config: AIClientConfig = {}) {
    this.geminiApiKey =
      config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.geminiModel =
      config.deployment ??
      process.env.GEMINI_MODEL ??
      "gemini-3-flash-preview";
    this.timeoutSeconds =
      config.timeoutSeconds ??
      parseFloat(process.env.LLM_TIMEOUT_SECONDS ?? "45");
    this.maxRetries = parseInt(process.env.LLM_MAX_RETRIES ?? "1", 10);
    if (!Number.isFinite(this.timeoutSeconds) || this.timeoutSeconds <= 0) {
      this.timeoutSeconds = 45;
    }
    if (!Number.isFinite(this.maxRetries) || this.maxRetries < 0) {
      this.maxRetries = 1;
    }
    if (config.maxRetries != null) {
      this.maxRetries = Math.max(0, config.maxRetries);
    }
    const envMax = parseInt(process.env.GEMINI_MAX_ATTEMPTS ?? "8", 10);
    this.maxAttemptsPerCall = Math.min(
      16,
      Math.max(this.maxRetries + 1, Number.isFinite(envMax) ? envMax : 8)
    );
  }

  private resolveKeyAndModel(options?: AIRequestOptions): {
    apiKey: string;
    model: string;
  } {
    const apiKey = options?.apiKey ?? this.geminiApiKey;
    const model = options?.deployment ?? this.geminiModel;
    return { apiKey, model };
  }

  /**
   * Single chat completion; returns assistant message text (trimmed).
   */
  async completeAIChat(
    messages: AIChatMessage[],
    options: AIRequestOptions = {}
  ): Promise<string> {
    const { apiKey, model } = this.resolveKeyAndModel(options);
    if (!apiKey) {
      throw new Error(
        "Gemini is not configured: set GEMINI_API_KEY in your environment"
      );
    }
    if (!messages.length) {
      throw new Error("No messages sent to Gemini");
    }

    const url = getGeminiGenerateUrl(model);
    const timeoutSeconds = options.timeoutSeconds ?? this.timeoutSeconds;
    const timeoutMs = Math.round(timeoutSeconds * 1000);
    const payload = chatMessagesToGeminiPayload(
      messages,
      options.temperature ?? 0.2,
      options.maxTokens ?? 4096
    );

    let lastError: unknown;
    let emptyBodyRetries = 0;
    const maxEmptyRetries = this.maxRetries + 1;

    for (let attempt = 1; attempt <= this.maxAttemptsPerCall; attempt++) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal =
        options.signal != null
          ? mergeSignals(options.signal, timeoutSignal)
          : timeoutSignal;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(payload),
          signal,
        });
        console.log("Response from Gemini", response);
        const rawText = await response.text();

        if (response.status === 429) {
          if (attempt >= this.maxAttemptsPerCall) {
            throw new Error(
              "Gemini rate limit (429): too many requests. Wait a minute and try again, or check quota in Google AI Studio."
            );
          }
          const waitMs =
            parseRetryAfterMs(response) ??
            Math.min(60_000, Math.round(2000 * 1.6 ** (attempt - 1)));
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          const detail = formatGeminiHttpError(response.status, rawText);
          throw new Error(detail + forbiddenHint(response.status));
        }

        let data: GeminiGenerateContentResponse;
        try {
          data = JSON.parse(rawText) as GeminiGenerateContentResponse;
        } catch {
          throw new Error("Gemini response was not valid JSON");
        }
        const text = extractGeminiText(data);
        if (text) return text;

        emptyBodyRetries++;
        lastError = new Error("Gemini returned an empty response");
        if (emptyBodyRetries >= maxEmptyRetries) break;
        await sleep(400);
      } catch (err) {
        lastError = err;
        if (err instanceof Error && err.message.includes("429")) throw err;
        break;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "Gemini request failed"));
  }

  /**
   * One user message, optional system prompt (same shape as before).
   */
  async completeAI(
    userPrompt: string,
    options?: AIRequestOptions
  ): Promise<string> {
    const messages: AIChatMessage[] = [];
    if (options?.systemPrompt?.trim()) {
      messages.push({
        role: "system",
        content: options.systemPrompt.trim(),
      });
    }
    messages.push({ role: "user", content: userPrompt });
    return this.completeAIChat(messages, options);
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const merged = new AbortController();
  const abort = () => merged.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return merged.signal;
}
