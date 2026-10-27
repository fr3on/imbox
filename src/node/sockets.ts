// The mail protocols (IMAP, SMTP) open their connections with `connect()` from here: Node's `net` and `tls` behind the small socket interface they use.
//
// What the callers rely on, and what this keeps: `readable` and `writable` are web streams, `close()` ends the connection, and `startTls()` upgrades a
// connection opened with `secureTransport: "starttls"` and returns the secure one. Certificates are checked.

import net from "node:net";
import tls from "node:tls";

export interface SocketAddress {
  hostname: string;
  port: number;
}
export interface SocketOptions {
  /** `on`: TLS from the first byte. `starttls`: plain until `startTls()` is called. `off`: plain. */
  secureTransport?: "on" | "off" | "starttls";
  allowHalfOpen?: boolean;
  /** Node only: extra TLS options, for a private certificate authority. A server's own CA can also be added with NODE_EXTRA_CA_CERTS. */
  tls?: tls.ConnectionOptions;
}
export interface NodeSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<void>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(): NodeSocket;
}

/** Bytes from a socket as a web stream. Reading is paused when the reader falls behind. A plain socket that is about to be upgraded must survive its reader being cancelled. */
function readableOf(sock: net.Socket, destroyOnCancel: boolean): ReadableStream<Uint8Array> {
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      sock.on("data", (chunk: Buffer) => {
        if (done) return;
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if ((controller.desiredSize ?? 1) <= 0) sock.pause();
      });
      sock.on("end", () => {
        if (done) return;
        done = true;
        controller.close();
      });
      sock.on("error", (e) => {
        if (done) return;
        done = true;
        controller.error(e);
      });
    },
    pull() {
      sock.resume();
    },
    cancel() {
      done = true;
      if (destroyOnCancel) sock.destroy();
      else {
        // Handing the socket over to TLS: stop listening, and leave it open.
        sock.pause();
        sock.removeAllListeners("data");
        sock.removeAllListeners("end");
      }
    },
  });
}

function writableOf(sock: net.Socket): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: (chunk) => new Promise<void>((resolve, reject) => sock.write(chunk, (e) => (e ? reject(e) : resolve()))),
    close: () => new Promise<void>((resolve) => sock.end(() => resolve())),
    abort: (reason) => void sock.destroy(reason instanceof Error ? reason : undefined),
  });
}

function wrap(sock: net.Socket, hostname: string, upgradable: boolean, tlsOptions?: tls.ConnectionOptions): NodeSocket {
  const opened = new Promise<void>((resolve, reject) => {
    sock.once(sock instanceof tls.TLSSocket ? "secureConnect" : "connect", () => resolve());
    sock.once("error", reject);
  });
  opened.catch(() => {});
  const closed = new Promise<void>((resolve) => sock.once("close", () => resolve()));
  return {
    readable: readableOf(sock, !upgradable),
    writable: writableOf(sock),
    opened,
    closed,
    close: () => {
      if (sock.destroyed) return Promise.resolve();
      sock.destroy();
      return closed;
    },
    startTls: () => wrap(tls.connect({ ...tlsOptions, socket: sock, servername: net.isIP(hostname) ? undefined : hostname }), hostname, false, tlsOptions),
  };
}

export function connect(address: SocketAddress | string, options: SocketOptions = {}): NodeSocket {
  const { hostname, port } = typeof address === "string" ? parseAddress(address) : address;
  const mode = options.secureTransport ?? "off";
  const allowHalfOpen = options.allowHalfOpen ?? false;
  if (mode === "on") return wrap(tls.connect({ ...options.tls, host: hostname, port, servername: net.isIP(hostname) ? undefined : hostname }), hostname, false, options.tls);
  return wrap(net.connect({ host: hostname, port, allowHalfOpen }), hostname, mode === "starttls", options.tls);
}

function parseAddress(a: string): SocketAddress {
  const i = a.lastIndexOf(":");
  return { hostname: a.slice(0, i), port: Number(a.slice(i + 1)) };
}
