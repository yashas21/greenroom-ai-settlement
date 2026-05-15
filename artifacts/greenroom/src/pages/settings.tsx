import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Check, KeyRound, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import type { LlmProvider, LlmStatus } from "@/lib/types";

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
};

export default function SettingsPage() {
  const state = useApiData(() => api.llmSettings(), []);

  if (state.status === "loading") return <LoadingState label="Loading settings..." />;
  if (state.status === "error")
    return <LoadingState label={`Error: ${state.error.message}`} />;

  return <SettingsForm initial={state.data} />;
}

function SettingsForm({ initial }: { initial: LlmStatus }) {
  const [status, setStatus] = useState<LlmStatus>(initial);
  const [provider, setProvider] = useState<LlmProvider>(initial.activeProvider);
  const [anthropicModel, setAnthropicModel] = useState(initial.providers.anthropic.model);
  const [openaiModel, setOpenaiModel] = useState(initial.providers.openai.model);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (savedAt == null) return;
    const t = setTimeout(() => setSavedAt(null), 2400);
    return () => clearTimeout(t);
  }, [savedAt]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveLlmSettings({
        provider,
        anthropicModel,
        openaiModel,
        ...(anthropicKey.trim() ? { anthropicApiKey: anthropicKey.trim() } : {}),
        ...(openaiKey.trim() ? { openaiApiKey: openaiKey.trim() } : {}),
      });
      setStatus(next);
      setAnthropicKey("");
      setOpenaiKey("");
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(p: LlmProvider) {
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveLlmSettings(
        p === "anthropic" ? { anthropicApiKey: null } : { openaiApiKey: null },
      );
      setStatus(next);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-12 py-10 max-w-[860px]">
      <div className="eyebrow text-[10px] text-brand-700 mb-2">Configuration</div>
      <h1 className="text-4xl font-serif text-ink-900 mb-2 tracking-tight">Settings</h1>
      <p className="text-[14px] text-ink-600 max-w-2xl mb-8 leading-relaxed">
        Configure the LLM used for show summaries, settlement enrichment, and
        complaint clustering. Keys are stored locally in your Greenroom database
        and override the server's environment defaults.
      </p>

      <Card className="mb-6">
        <CardContent className="space-y-6">
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-3">Active provider</div>
            <div className="flex gap-2">
              {(["anthropic", "openai"] as LlmProvider[]).map((p) => {
                const active = provider === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvider(p)}
                    className={
                      "flex-1 px-4 py-3 rounded-lg ring-1 text-left transition-all " +
                      (active
                        ? "bg-brand-50 ring-brand-300 text-ink-900"
                        : "bg-white ring-ink-200/60 text-ink-600 hover:ring-ink-300")
                    }
                  >
                    <div className="text-[13px] font-medium flex items-center justify-between">
                      {PROVIDER_LABEL[p]}
                      {active ? <Check className="h-4 w-4 text-brand-700" /> : null}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {status.providers[p].configured
                        ? `Configured (${status.providers[p].source})`
                        : "Not configured"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <ProviderBlock
            provider="anthropic"
            label="Anthropic"
            placeholder="sk-ant-..."
            keyValue={anthropicKey}
            setKeyValue={setAnthropicKey}
            model={anthropicModel}
            setModel={setAnthropicModel}
            models={status.models.anthropic}
            providerStatus={status.providers.anthropic}
            onClear={() => clearKey("anthropic")}
            disabled={saving}
          />

          <ProviderBlock
            provider="openai"
            label="OpenAI"
            placeholder="sk-..."
            keyValue={openaiKey}
            setKeyValue={setOpenaiKey}
            model={openaiModel}
            setModel={setOpenaiModel}
            models={status.models.openai}
            providerStatus={status.providers.openai}
            onClear={() => clearKey("openai")}
            disabled={saving}
          />

          <div className="flex items-center gap-3 pt-2 border-t border-ink-100">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </Button>
            {savedAt ? (
              <span className="text-[12px] text-emerald-700 flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            ) : null}
            {error ? (
              <span className="text-[12px] text-rose-700 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </span>
            ) : null}
            <span className="ml-auto text-[11px] text-ink-400">
              <SettingsIcon className="inline h-3 w-3 mr-1 -mt-0.5" />
              Active: {PROVIDER_LABEL[status.activeProvider]} · {status.activeModel}
              {status.hasKey ? "" : " · no key"}
            </span>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11.5px] text-ink-400 leading-relaxed">
        Saved keys are written to the <code className="text-[11px] bg-ink-50 px-1 py-0.5 rounded">settings</code>{" "}
        table and used for both per-show export summaries and the Insights
        clustering pipeline. If no key is saved, the server falls back to{" "}
        <code className="text-[11px] bg-ink-50 px-1 py-0.5 rounded">AI_INTEGRATIONS_*_API_KEY</code>{" "}
        environment variables.
      </p>
    </section>
  );
}

function ProviderBlock({
  label,
  placeholder,
  keyValue,
  setKeyValue,
  model,
  setModel,
  models,
  providerStatus,
  onClear,
  disabled,
}: {
  provider: LlmProvider;
  label: string;
  placeholder: string;
  keyValue: string;
  setKeyValue: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  models: string[];
  providerStatus: { configured: boolean; source: "settings" | "env" | "none"; model: string };
  onClear: () => void;
  disabled: boolean;
}) {
  const hasSavedKey = providerStatus.source === "settings";
  return (
    <div className="rounded-lg ring-1 ring-ink-200/60 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium text-ink-900">{label}</div>
        <div className="text-[11px] text-ink-500">
          {providerStatus.configured ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Check className="h-3 w-3" />
              {providerStatus.source === "settings" ? "key saved" : "using env var"}
            </span>
          ) : (
            <span className="text-ink-400">no key</span>
          )}
        </div>
      </div>

      <div>
        <Label className="text-[11px] text-ink-500 mb-1 block">
          API key {hasSavedKey ? "(leave blank to keep current)" : ""}
        </Label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
            <Input
              type="password"
              placeholder={hasSavedKey ? "•••••••• (saved)" : placeholder}
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              disabled={disabled}
              className="pl-9 font-mono text-[12px]"
              autoComplete="off"
            />
          </div>
          {hasSavedKey ? (
            <Button
              variant="outline"
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="text-[12px]"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <Label className="text-[11px] text-ink-500 mb-1 block">Model</Label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-md ring-1 ring-ink-200/60 bg-white text-[13px] text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
