import { Code, ImageOff, Link2 } from "lucide-react";
import { BrandIcon } from "../BrandIcons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RemoteImages } from "../../lib/remoteImages";

// What is said above the message about what was held back: the trackers that were removed, and the images from other servers that are not loaded.

/** What the sanitiser records for a blocked image is the sender's host, or a generic reason when the image has no usable host. */
export function trackerLabel(t: string): string {
  if (t === "pixel") return "Tiny hidden image";
  if (t === "hidden-image") return "Hidden image";
  if (t === "tracker") return "Known tracker";
  return t;
}

/** The badge and the list behind it that tell the reader which trackers were blocked. */
export function TrackerNotice({ trackers }: { trackers: string[] }) {
  return (
    <div className="mb-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="max-w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${trackers.length} tracker${trackers.length === 1 ? "" : "s"} blocked. Show details`}>
            <Badge variant="secondary" className="max-w-full cursor-pointer font-normal text-muted-foreground hover:text-foreground">
              <BrandIcon name="let-in" />
              <span className="truncate">
                Blocked {trackers.length} tracker{trackers.length === 1 ? "" : "s"} · {trackers.slice(0, 2).map(trackerLabel).join(", ")}
                {trackers.length > 2 ? ` +${trackers.length - 2}` : ""}
              </span>
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {trackers.length} tracker{trackers.length === 1 ? "" : "s"} blocked
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {trackers.length === 1 ? "A hidden image that tells" : "Hidden images that tell"} a sender when and where you opened this. {trackers.length === 1 ? "It" : "They"} never loaded.
              </p>
            </div>
            <ul className="divide-y rounded-md border text-xs">
              {trackers.map((t) => (
                <li key={t} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="truncate font-mono text-foreground">{trackerLabel(t)}</span>
                  <span className="shrink-0 text-muted-foreground">Blocked</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <ImageOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Other images wait until you show them
              </li>
              <li className="flex items-start gap-2">
                <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Links can still tell a sender you clicked
              </li>
              <li className="flex items-start gap-2">
                <Code className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Scripts and frames are always removed
              </li>
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The line that says how many images were held back and from where, with the buttons that let them through. */
export function ImageNotice({ remote, loadImages, trusted, senderKey, savedSenders, setShown, saveSenders }: {
  remote: RemoteImages;
  loadImages: boolean;
  trusted: boolean;
  senderKey: string;
  savedSenders: string[];
  setShown: (shown: boolean) => void;
  saveSenders: (next: string[]) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-muted-foreground">
      <ImageOff className="mr-1 size-3.5 shrink-0" />
      {loadImages ? (
        <>
          <span>{trusted ? "Images always shown for this sender" : `Images shown · ${remote.hosts.slice(0, 2).join(", ")}${remote.hosts.length > 2 ? ` +${remote.hosts.length - 2}` : ""}`}</span>
          {trusted ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => saveSenders(savedSenders.filter((x) => x.toLowerCase() !== senderKey))}>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setShown(false)}>
              Hide
            </Button>
          )}
        </>
      ) : (
        <>
          <span>
            {remote.count} image{remote.count === 1 ? "" : "s"} not loaded · {remote.hosts.slice(0, 2).join(", ")}
            {remote.hosts.length > 2 ? ` +${remote.hosts.length - 2}` : ""}
          </span>
          <Button variant="ghost" size="xs" className="text-foreground" onClick={() => setShown(true)}>
            Show images
          </Button>
          {senderKey && (
            <Button variant="ghost" size="xs" className="max-w-full text-muted-foreground" onClick={() => saveSenders([...new Set([...savedSenders, senderKey])])}>
              <span className="truncate">Always for {senderKey}</span>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
