import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyTheme, useAccount } from "@/context/AccountContext";
import { useMeMutations } from "@/api";
import { PRESETS, setMenuPreset, useMenuPreset, type PresetId } from "@/lib/menuPresets";
import { PRESET_ICON } from "@/components/presetIcons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/**
 * Step 3: Choose Color Theme (Light / Dark / System)
 * and Menu Style Preset (Full / Sort / Reply / Plan / Focus)
 */
export function AppearanceStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  const { user } = useAccount();
  const { update } = useMeMutations();
  const initialTheme = (user?.settings?.theme as "light" | "dark" | "system") ?? "system";
  const [theme, setTheme] = useState<"light" | "dark" | "system">(initialTheme);
  const menuPreset = useMenuPreset();

  const handleSelectTheme = (t: "light" | "dark" | "system") => {
    setTheme(t);
    applyTheme(t);
    update.mutate({ settings: { ...(user?.settings ?? {}), theme: t } });
  };

  const handleSelectPreset = (id: PresetId) => {
    setMenuPreset(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Appearance & Menu Style</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Choose a theme and navigation style that fits how you work. You can change these anytime in Settings.
        </p>
      </div>

      {/* Theme selection */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground tracking-tight">
            Theme
          </Label>
          <span className="text-[11px] text-muted-foreground capitalize">
            {theme === "system" ? "Follows device" : `${theme} mode`}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {[
            { id: "light" as const, label: "Light", desc: "Clean & bright", icon: <Sun className="size-4" /> },
            { id: "dark" as const, label: "Dark", desc: "Easy on eyes", icon: <Moon className="size-4" /> },
            { id: "system" as const, label: "System", desc: "Match device", icon: <Monitor className="size-4" /> },
          ].map((t) => {
            const isSelected = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTheme(t.id)}
                className={cn(
                  "group relative flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-foreground bg-muted/60 shadow-xs"
                    : "border-border bg-card/60 hover:border-foreground/30 hover:bg-muted/30"
                )}
              >
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors",
                    isSelected
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  {t.icon}
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground">{t.label}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5">{t.desc}</div>
                </div>
                {isSelected && (
                  <div className="absolute top-2 right-2 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="size-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Menu Style Presets */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground tracking-tight">
            Menu Style
          </Label>
          <span className="text-[11px] text-muted-foreground">
            Current: {menuPreset.label}
          </span>
        </div>

        <div className="space-y-2">
          {PRESETS.map((p) => {
            const isSelected = menuPreset.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p.id)}
                className={cn(
                  "group flex w-full items-center gap-3.5 rounded-xl border p-3 text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-foreground bg-muted/60 shadow-xs"
                    : "border-border bg-card/60 hover:border-foreground/30 hover:bg-muted/30"
                )}
              >
                <div
                  className={cn(
                    "flex size-8.5 shrink-0 items-center justify-center rounded-lg transition-colors [&>svg]:size-4",
                    isSelected
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  {PRESET_ICON[p.id]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{p.label}</span>
                    {p.id === "complete" && (
                      <Badge variant="outline" className="text-[9.5px] font-normal py-0 px-1.5 h-4">
                        Default
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">
                    {p.blurb}
                  </p>
                </div>
                <div className="flex size-5 shrink-0 items-center justify-center">
                  {isSelected ? (
                    <div className="flex size-4.5 items-center justify-center rounded-full bg-foreground text-background">
                      <Check className="size-3 stroke-[3]" />
                    </div>
                  ) : (
                    <div className="size-4 rounded-full border border-border group-hover:border-foreground/40" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Continue */}
      <div className="pt-2">
        <Button size="lg" className="w-full h-11 font-medium cursor-pointer" onClick={onContinue}>
          Continue to Ready <ArrowRight className="size-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}
