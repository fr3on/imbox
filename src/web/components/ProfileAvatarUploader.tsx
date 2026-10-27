import { BrandIcon } from "./BrandIcons";
import React, { useRef, useState } from "react";
import { Camera, Upload, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initials } from "../lib/format";

interface ProfileAvatarUploaderProps {
  email: string;
  name: string;
  avatarUrl?: string;
  connectedAccountAvatars?: { email: string; avatar_url: string; provider: string }[];
  onChange: (url: string) => void;
  disabled?: boolean;
}

export async function computeGravatarUrl(email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(clean);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `https://gravatar.com/avatar/${hashHex}?s=256&d=mp`;
}

/** Resizes an uploaded image file to max 256x256 square WebP/JPEG data url */
function processImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image format"));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not initialize canvas context"));
          return;
        }

        // Center crop
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        
        // Export as WebP if supported, fallback to jpeg
        try {
          const dataUrl = canvas.toDataURL("image/webp", 0.85);
          if (dataUrl.startsWith("data:image/webp")) {
            resolve(dataUrl);
            return;
          }
        } catch {
          // fallback
        }
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileAvatarUploader({
  email,
  name,
  avatarUrl,
  connectedAccountAvatars = [],
  onChange,
  disabled,
}: ProfileAvatarUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasPhoto = !!avatarUrl && !imgError;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const dataUrl = await processImageFile(file);
      setImgError(false);
      onChange(dataUrl);
    } catch (err) {
      console.error("Avatar process error", err);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleUseGravatar = async () => {
    try {
      setLoading(true);
      const gravatar = await computeGravatarUrl(email);
      setImgError(false);
      onChange(gravatar);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <div className="relative group cursor-pointer inline-block shrink-0 select-none">
            {/* Avatar display */}
            <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-full ring-2 ring-border/80 bg-muted shadow-2xs overflow-hidden flex items-center justify-center transition-all duration-200 group-hover:ring-foreground/40">
              {hasPhoto ? (
                <img
                  src={avatarUrl}
                  alt={name || email}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-semibold text-2xl sm:text-3xl text-foreground/75 tracking-wider bg-secondary/80">
                  {initials(name || "", email)}
                </div>
              )}
            </div>

            {/* Hover overlay badge */}
            <div className="absolute inset-0 rounded-full bg-black/50 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-0.5 text-[10.5px] font-medium">
              <Camera size={16} className="animate-in fade-in" />
              <span>Edit</span>
            </div>

            {/* Corner camera button pill */}
            <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-background border border-border shadow-2xs flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
              {loading ? <RefreshCw size={11} className="animate-spin" /> : <Camera size={11} />}
            </div>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Profile photo
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="cursor-pointer gap-2">
            <Upload size={14} />
            <span>Upload image</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleUseGravatar} className="cursor-pointer gap-2">
            <BrandIcon name="assistant" size={14} />
            <span>Use Gravatar</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCustomUrlInput(avatarUrl || "");
              setUrlModalOpen(true);
            }}
            className="cursor-pointer gap-2"
          >
            <Link2 size={14} />
            <span>Image link…</span>
          </DropdownMenuItem>

          {connectedAccountAvatars.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                From connected accounts
              </DropdownMenuLabel>
              {connectedAccountAvatars.map((acc) => (
                <DropdownMenuItem
                  key={acc.email}
                  onClick={() => {
                    setImgError(false);
                    onChange(acc.avatar_url);
                  }}
                  className="cursor-pointer gap-2 text-xs"
                >
                  <img src={acc.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                  <span className="truncate">{acc.email}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}

          {hasPhoto && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setImgError(false);
                  onChange("");
                }}
                className="cursor-pointer gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <BrandIcon name="trash" size={14} />
                <span>Remove photo</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Direct URL input dialog */}
      <Dialog open={urlModalOpen} onOpenChange={setUrlModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile image URL</DialogTitle>
            <DialogDescription>
              Enter a direct link to any public image (PNG, JPG, WebP, SVG).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="https://example.com/avatar.jpg"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!customUrlInput.trim()}
              onClick={() => {
                setImgError(false);
                onChange(customUrlInput.trim());
                setUrlModalOpen(false);
              }}
            >
              Apply image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
