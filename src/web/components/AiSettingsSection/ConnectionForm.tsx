
import { Check, ExternalLink, ListChecks, Loader2, } from "lucide-react";
import { toast } from "sonner";
import type { AiPreset, AiSettings } from "@shared/types";
import { useAiMutations, useAiModels, } from "../../api";
import { Row, Panel, } from "../../settings/parts";
import { ProviderPicker } from "./ProviderPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelPicker } from "./ModelPicker";

/** The form that connects a provider: provider, base URL, key and model, then Save, Cancel and Test. It is the whole screen until a provider works. */
export function ConnectionForm({ s, configured, p, preset, choosePreset, baseUrl, setBaseUrl, setModelsOpen, setDirty, apiKey: key, setKey, inputCls, m, models, modelOptions, pickerOpen, setPickerOpen, modelQuery, setModelQuery, model, setModel, save, cancelEdit, runTest, dirty }: {
  s: AiSettings | undefined;
  configured: boolean;
  p: AiPreset | undefined;
  preset: AiPreset["id"];
  choosePreset: (id: AiPreset["id"]) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  setModelsOpen: (open: boolean) => void;
  setDirty: (dirty: boolean) => void;
  apiKey: string;
  setKey: (key: string) => void;
  inputCls: string;
  m: ReturnType<typeof useAiMutations>;
  models: ReturnType<typeof useAiModels>;
  modelOptions: string[];
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  modelQuery: string;
  setModelQuery: (q: string) => void;
  model: string;
  setModel: (model: string) => void;
  save: () => void;
  cancelEdit: () => void;
  runTest: () => void;
  dirty: boolean;
}) {
  return (
    <>
      {!configured && (
        <ol className="mx-4 sm:mx-5 mb-3 list-inside list-decimal space-y-0.5 text-[13px] text-muted-foreground">
          <li>Choose a provider.</li>
          <li>Add your key.</li>
          <li>Pick a model, save, then test it.</li>
        </ol>
      )}
      <Panel>
        <Row label="Provider" hint={p ? `${p.blurb}${p.base_url && !p.editable_url ? ` ${p.base_url}` : ""}` : "Choose your model provider"}>
          <ProviderPicker presets={s?.presets ?? []} value={preset} onChange={choosePreset} className={inputCls} />
        </Row>

        {p?.editable_url && (
          <Row label="Base URL" hint={p.group === "local" ? "Where it listens. Your imbox server makes the calls, so this must be reachable from the server, not only from this browser." : p.id === "bedrock" ? "The region is in the address. Change it to use another one." : "Any OpenAI-compatible server, ending in /v1."}>
            <Input
              id="ai-base"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setModelsOpen(false);
                setDirty(true);
              }}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
          </Row>
        )}

        <Row label="API key" hint="Stored encrypted on your server and never shown again.">
          <div className="flex flex-col gap-1 items-end w-full">
            <Input
              id="ai-key"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setDirty(true);
              }}
              placeholder={s?.key_hint ? `Stored · ${s.key_hint}` : p?.key_placeholder ?? "API key"}
              autoComplete="off"
              className={inputCls}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              {p?.key_url && (
                <a className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground" href={p.key_url} target="_blank" rel="noreferrer">
                  Get a key <ExternalLink className="size-3" />
                </a>
              )}
              {s?.key_hint && (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-destructive text-muted-foreground"
                  onClick={() => m.saveSettings.mutate({ api_key: null }, { onSuccess: () => toast("Key removed") })}
                >
                  Remove key
                </button>
              )}
            </div>
          </div>
        </Row>

        <Row
          label="Model"
          hint={
            models.isFetching
              ? "Loading models list…"
              : models.data?.error
              ? "Couldn’t load the list from the provider. Type the model name instead."
              : models.data?.models?.length
              ? `${modelOptions.length} models from ${p?.label ?? "the provider"} · pick or search`
              : "Pick a model, or search to enter any supported model ID."
          }
        >
          <ModelPicker pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} setModelsOpen={setModelsOpen} modelQuery={modelQuery} setModelQuery={setModelQuery} models={models} modelOptions={modelOptions} model={model} setModel={setModel} setDirty={setDirty} p={p} inputCls={inputCls} />
        </Row>
      </Panel>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
        <Button size="sm" onClick={save} disabled={m.saveSettings.isPending || (!dirty && !key)}>
          {m.saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save
        </Button>
        {configured && (
          <Button size="sm" variant="outline" onClick={cancelEdit}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={runTest} disabled={m.check.isPending || !configured || dirty}>
          {m.check.isPending ? <Loader2 className="animate-spin" /> : <ListChecks />} Test
        </Button>
      </div>
    </>
  );
}
