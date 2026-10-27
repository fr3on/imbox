import { BrandIcon } from "@/components/BrandIcons";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useClipMutations } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ThreadDetail, } from "@shared/types";

export function ClipsRow({ t }: { t: ThreadDetail }) {
  const clips = useClipMutations();
  return (
    <>
      {/* Clips */}
      {t.clips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.clips.map((c) => (
            <Badge key={c.id} variant="secondary" className="group max-w-full font-normal pr-0.5 h-6" title={c.text}>
              <BrandIcon name="clips" className="text-muted-foreground" />
              <span className="truncate max-w-72">“{c.text}”</span>
              <Button variant="ghost" size="icon-xs" className="size-5 text-muted-foreground" aria-label="Delete clip" onClick={() => clips.remove.mutate(c.id, { onSuccess: () => toast("Clip removed") })}>
                <X />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}
