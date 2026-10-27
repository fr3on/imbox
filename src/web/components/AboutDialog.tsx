import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Copy, ExternalLink, } from "lucide-react";
import { useState } from "react";
import { BrandIcon } from "./BrandIcons";
import { Mark } from "./Logo";
import { BUILT_AT, COMMIT, REPO_IS_GITHUB, REPO_LABEL, REPO_URL, VERSION } from "../../shared/buildInfo";

// GitHub shows the README under the project; a GitLab project page does the same, so the plain address is the docs link there.
const DOCS_URL = REPO_IS_GITHUB ? `${REPO_URL}#readme` : REPO_URL;

export function AboutDialog({
  open,
  onClose,
  appName = "Imbox",
  onShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  appName?: string;
  onShortcuts?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCommit = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(COMMIT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const formattedDate = (() => {
    try {
      return new Date(BUILT_AT).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return BUILT_AT;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px] p-6 gap-5">
        <DialogHeader className="gap-1.5 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Mark size={32} />
              <DialogTitle className="text-base font-semibold tracking-tight">
                {appName}
              </DialogTitle>
            </div>
            <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5 font-normal">
              v{VERSION}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            Fast, keyboard-first, distraction-free mail with autonomous AI agents.
          </DialogDescription>
        </DialogHeader>

        {/* Info Grid */}
        <div className="rounded-lg border border-border/70 divide-y divide-border/50 text-xs">
          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono font-medium text-foreground">{VERSION}</span>
          </div>

          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">Commit</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-foreground">{COMMIT}</span>
              <button
                type="button"
                onClick={copyCommit}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
                title="Copy commit SHA"
              >
                {copied ? <Check size={13} className="text-foreground" /> : <Copy size={13} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">Build Date</span>
            <span className="text-foreground">{formattedDate}</span>
          </div>

          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">Runtime</span>
            <span className="text-foreground">Node.js</span>
          </div>

          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">Database</span>
            <span className="text-foreground">PostgreSQL 16+</span>
          </div>

          <div className="flex items-center justify-between p-2.5">
            <span className="text-muted-foreground">License</span>
            <span className="text-foreground">MIT License</span>
          </div>
        </div>

        {/* Action Links & Footer */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3 text-xs">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
            >
              Docs <ExternalLink size={11} />
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
            >
              {REPO_LABEL} <ExternalLink size={11} />
            </a>
            {onShortcuts && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onShortcuts();
                }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <BrandIcon name="shortcuts" size={12} />
                Shortcuts (?)
              </button>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs px-3">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
