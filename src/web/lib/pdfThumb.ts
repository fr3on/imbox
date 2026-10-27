// The first page of a PDF as a small picture, drawn in the browser from the file your own server hands over. Nothing is sent anywhere.
// The reader library is loaded the first time a thumbnail is wanted, and a few are drawn at a time so scrolling stays smooth.

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_BYTES = 15 * 1024 * 1024;
const WIDTH = 360;
const PARALLEL = 2;

const done = new Map<string, Promise<string | null>>();
let running = 0;
const waiting: (() => void)[] = [];

async function draw(url: string): Promise<string | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  // The file is a stranger's. No eval-compiled fast paths, so a malformed one has less to work with (the reader is also never given a scripting engine).
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, canvas, viewport, background: "#ffffff" }).promise;
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    void doc.cleanup();
  }
}

/** A data URL of page one, or null when it cannot be drawn (too big, locked, broken). Asking twice for the same file draws it once. */
export function pdfThumb(url: string): Promise<string | null> {
  const hit = done.get(url);
  if (hit) return hit;
  const p = new Promise<string | null>((resolve) => {
    const start = () => {
      running += 1;
      draw(url)
        .catch(() => null)
        .then(resolve)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < PARALLEL) start();
    else waiting.push(start);
  });
  done.set(url, p);
  return p;
}
