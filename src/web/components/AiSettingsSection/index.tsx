
import { useEffect, useState, } from "react";
import { toast } from "sonner";
import type { AiCheckResponse, AiPreset, } from "@shared/types";
import { useAiMemory, useAiMutations, useAiSettings, useAiModels, useAiUsage } from "../../api";
import { Section, Danger, SectionsProvider } from "../../settings/parts";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionSummary } from "./ConnectionSummary";
import { FeaturesSection } from "./FeaturesSection";
import { JevSection } from "./JevSection";
import { MemoryOverview } from "./MemoryOverview";
import { MemorySection } from "./MemorySection";
import { TestReport } from "./TestReport";

// Parts the tests draw on their own, reached through the file's old path.
export { FeatureRow } from "./FeatureRow";
export { MemorySection } from "./MemorySection";

/** Model ids that are not for chat: the providers list them with the rest. */
export const NOT_CHAT = /(^|[-/._])(embed(ding)?s?|whisper|tts|dall-?e|moderation|rerank(er)?|transcribe|realtime|image|audio)([-/._]|$)/i;

export function AiSection({ compact }: { compact?: boolean }) {
  const settings = useAiSettings();
  const m = useAiMutations();
  const usage = useAiUsage(30);
  const s = settings.data;
  const [preset, setPreset] = useState<AiPreset["id"]>("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [dirty, setDirty] = useState(false);
  // The connection is a one-line summary once it works. Edit opens the form; until a provider works the form is simply there.
  const [editing, setEditing] = useState(false);
  // What the last Test found. Any edit to the settings makes it stale, so it is cleared.
  const [report, setReport] = useState<AiCheckResponse | null>(null);
  useEffect(() => {
    if (dirty) setReport(null);
  }, [dirty]);
  const [clearOpen, setClearOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [showMemory, setShowMemory] = useState(false);
  const [savedMark, setSavedMark] = useState(false);

  useEffect(() => {
    if (!s || dirty) return;
    setPreset(s.preset);
    setBaseUrl(s.presets.find((x) => x.id === s.preset)?.editable_url ? s.base_url : "");
    setModel(s.model);
  }, [s, dirty]);

  // The list is fetched as soon as the form shows with a key to ask with (the saved one counts), not only once the picker is opened.
  const models = useAiModels(modelsOpen || ((editing || !s?.configured) && (!!s?.configured || !!key.trim())), preset, baseUrl, key.trim());
  const inputCls = compact ? "w-full h-11 text-[16px]" : "w-64 sm:w-80";
  const p = s?.presets.find((x) => x.id === preset) ?? s?.presets[0];
  // What this provider lists, without what is not for chatting (embeddings, speech, images, moderation). When it lists nothing, a known
  // provider falls back to its usual models; a custom endpoint has no usual ones. The model in use is always there to pick again.
  const listed = (models.data?.models ?? []).filter((x) => !NOT_CHAT.test(x));
  const base = listed.length ? listed : p?.id === "custom" ? [] : p?.models ?? [];
  const modelOptions = model && !base.includes(model) ? [model, ...base] : base;
  const configured = !!s?.configured;
  const formOpen = editing || !configured;

  const choosePreset = (id: AiPreset["id"]) => {
    const np = s?.presets.find((x) => x.id === id);
    setModelsOpen(false);
    setPreset(id);
    setModel(np?.default_model ?? "");
    setBaseUrl(np?.editable_url ? np.base_url : "");
    setDirty(true);
  };

  const save = () =>
    m.saveSettings.mutate(
      { preset, base_url: p?.editable_url ? baseUrl : undefined, api_key: key.trim() ? key.trim() : undefined, model },
      {
        onSuccess: () => {
          toast("AI settings saved");
          setKey("");
          setDirty(false);
          setEditing(false);
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  const cancelEdit = () => {
    setKey("");
    setDirty(false);
    setEditing(false);
  };

  // Connection and features in one go: the check starts with a plain call, so a bad key or URL shows up as the first line.
  const runTest = () =>
    m.check.mutate(undefined, {
      onSuccess: setReport,
      onError: (e) => {
        setReport(null);
        toast.error((e as Error).message, { duration: 10000 });
      },
    });

  // Switches save the moment they are flipped.
  const flip = (patch: Parameters<typeof m.saveSettings.mutate>[0]) =>
    m.saveSettings.mutate(patch, {
      onSuccess: () => {
        setSavedMark(true);
        window.setTimeout(() => setSavedMark(false), 1800);
      },
      onError: (e) => toast.error((e as Error).message),
    });

  const used = new Map((usage.data?.by_feature ?? []).map((f) => [f.feature, f.tokens_in + f.tokens_out]));
  const tok = (k: string) => (usage.data ? used.get(k) ?? 0 : undefined);
  const LISTED = ["screener", "brief", "actions", "gist", "learn", "rescue", "agents"];
  const top = Math.max(1, ...LISTED.map((k) => used.get(k) ?? 0));
  const total = usage.data ? usage.data.totals.tokens_in + usage.data.totals.tokens_out : 0;
  const onRequest = Math.max(0, total - LISTED.reduce((n, k) => n + (used.get(k) ?? 0), 0));
  const presetLabel = s?.presets.find((x) => x.id === s.preset)?.label ?? s?.preset ?? "";
  const host = (() => {
    try {
      return new URL(s?.base_url || "").host;
    } catch {
      return "";
    }
  })();
  const memories = useAiMemory().data?.length ?? 0;

  return (
    <SectionsProvider>
      <Section title="AI" collapsible defaultOpen summary={configured ? `${presetLabel}, ${s?.model}` : "Not set up"} description="Bring your own key. Mail is only sent to the provider when an AI feature runs.">
        {s && !s.server_ready && (
          <div className="mx-4 sm:mx-5 mb-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            SESSION_SECRET isn't set on the server, so keys can't be stored yet.
          </div>
        )}

        {!formOpen && s ? (
          <ConnectionSummary s={s} presetLabel={presetLabel} host={host} usage={usage} total={total} runTest={runTest} setEditing={setEditing} m={m} />
        ) : (
          <ConnectionForm s={s} configured={configured} p={p} preset={preset} choosePreset={choosePreset} baseUrl={baseUrl} setBaseUrl={setBaseUrl} setModelsOpen={setModelsOpen} setDirty={setDirty} apiKey={key} setKey={setKey} inputCls={inputCls} m={m} models={models} modelOptions={modelOptions} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} modelQuery={modelQuery} setModelQuery={setModelQuery} model={model} setModel={setModel} save={save} cancelEdit={cancelEdit} runTest={runTest} dirty={dirty} />
        )}

        {m.check.isPending ? (
          <p className="mx-4 sm:mx-5 mt-3 text-xs text-muted-foreground">Trying the connection, streaming, tools and JSON with {s?.model || "the model"}… this takes a few seconds.</p>
        ) : null}

        {report && !dirty ? <TestReport report={report} setReport={setReport} /> : null}
      </Section>

      <JevSection compact={compact} />

      <FeaturesSection s={s} tok={tok} top={top} flip={flip} savedMark={savedMark} usage={usage} onRequest={onRequest} />

      <MemoryOverview memories={memories} s={s} showMemory={showMemory} setShowMemory={setShowMemory} m={m} />

      {showMemory && <MemorySection compact={compact} onClear={() => setClearOpen(true)} />}
      <Danger
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Forget everything?"
        body="Deletes every memory entry and the learning history. The assistant starts from scratch."
        action="Forget everything"
        onConfirm={() => m.clearMemory.mutate(undefined, { onSuccess: () => toast("Memory cleared") })}
      />
    </SectionsProvider>
  );
}
