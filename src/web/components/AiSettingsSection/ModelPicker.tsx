
import { Check, ChevronsUpDown, Plus, } from "lucide-react";
import type { AiPreset, } from "@shared/types";
import { useAiModels, } from "../../api";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** The model field: a search box over the models the endpoint lists, which also takes any model name typed in. */
export function ModelPicker({ pickerOpen, setPickerOpen, setModelsOpen, modelQuery, setModelQuery, models, modelOptions, model, setModel, setDirty, p, inputCls }: {
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  setModelsOpen: (open: boolean) => void;
  modelQuery: string;
  setModelQuery: (q: string) => void;
  models: ReturnType<typeof useAiModels>;
  modelOptions: string[];
  model: string;
  setModel: (model: string) => void;
  setDirty: (dirty: boolean) => void;
  p: AiPreset | undefined;
  inputCls: string;
}) {
  return (
    <Popover
      open={pickerOpen}
      onOpenChange={(o) => {
        setPickerOpen(o);
        if (o) setModelsOpen(true);
        else setModelQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={pickerOpen} className={cn("justify-between font-normal text-xs", inputCls)} id="ai-model">
          <span className={cn("truncate", !model && "text-muted-foreground")}>{model || p?.default_model || "Select a model"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command loop>
          <CommandInput placeholder="Search models…" value={modelQuery} onValueChange={setModelQuery} />
          <CommandList className="max-h-64">
            {models.isFetching ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Spinner />
              </div>
            ) : (
              <>
                <CommandEmpty>{modelQuery ? "No matching model. Press Use to enter it as typed." : models.data?.error ? `Couldn’t list models: ${models.data.error}` : "This endpoint lists no models. Type the model name."}</CommandEmpty>
                <CommandGroup>
                  {modelOptions.map((x) => (
                    <CommandItem
                      key={x}
                      value={x}
                      onSelect={() => {
                        setModel(x);
                        setDirty(true);
                        setPickerOpen(false);
                      }}
                    >
                      <span className="flex-1 truncate">{x}</span>
                      <Check className={cn("size-4", model === x ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {modelQuery.trim() && !modelOptions.some((x) => x === modelQuery.trim()) && (
              <>
                <CommandSeparator />
                <CommandGroup forceMount>
                  <CommandItem
                    value={`use-${modelQuery}`}
                    forceMount
                    onSelect={() => {
                      setModel(modelQuery.trim());
                      setDirty(true);
                      setPickerOpen(false);
                    }}
                  >
                    <Plus size={14} className="mr-1.5" />
                    <span className="truncate">Use “{modelQuery.trim()}”</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
