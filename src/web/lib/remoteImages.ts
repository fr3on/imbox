// What a message would load from other servers if images were allowed: pictures, CSS backgrounds, poster frames. Used only to tell the reader
// what is being held back. The block itself is enforced by the content-security policy in the message frame, not by this list.

export interface RemoteImages {
  /** Distinct remote image addresses. */
  count: number;
  /** Distinct sender hosts, in order of first appearance. */
  hosts: string[];
}

const isRemote = (u: string) => /^(https?:)?\/\//i.test(u);

export function findRemoteImages(html: string): RemoteImages {
  const urls = new Set<string>();
  const add = (raw: string | undefined) => {
    const u = (raw ?? "").trim().replace(/&amp;/gi, "&");
    if (u && isRemote(u)) urls.add(u);
  };

  // src, poster and the old background attribute on the tags that can carry an image.
  for (const tag of html.matchAll(/<(?:img|source|video|body|table|tr|td|th|div)\b[^>]*>/gi)) {
    for (const a of tag[0].matchAll(/\b(?:src|poster|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(a[1] ?? a[2] ?? a[3]);
    for (const a of tag[0].matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      for (const part of (a[1] ?? a[2] ?? "").split(",")) add(part.trim().split(/\s+/)[0]);
    }
  }
  // url(...) in style attributes and <style> blocks.
  for (const m of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi)) add(m[1] ?? m[2] ?? m[3]);

  const hosts: string[] = [];
  for (const u of urls) {
    try {
      const h = new URL(u.startsWith("//") ? `https:${u}` : u).hostname.toLowerCase();
      if (h && !hosts.includes(h)) hosts.push(h);
    } catch {
      /* not a usable address */
    }
  }
  return { count: urls.size, hosts };
}
