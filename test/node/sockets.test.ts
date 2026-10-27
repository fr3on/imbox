import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "../../src/node/sockets";

// The IMAP and SMTP code opens its connections with this. The tests use real local servers, one plain and two secure, with a certificate made for the run.

let key = "";
let cert = "";
const closers: (() => void)[] = [];

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sockets-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  key = fs.readFileSync(path.join(dir, "k.pem"), "utf8");
  cert = fs.readFileSync(path.join(dir, "c.pem"), "utf8");
});
afterAll(() => closers.forEach((c) => c()));

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return (server.address() as net.AddressInfo).port;
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("sockets for Node", () => {
  it("talks over a plain connection", async () => {
    const port = await listen(net.createServer((s) => s.on("data", (d) => s.write(`echo:${d}`))));
    const sock = connect({ hostname: "127.0.0.1", port });
    const reader = sock.readable.getReader();
    const writer = sock.writable.getWriter();
    await writer.write(new TextEncoder().encode("hi"));
    expect(text((await reader.read()).value!)).toBe("echo:hi");
    await sock.close();
    await sock.closed;
  });

  it("talks over TLS from the first byte, and checks the certificate", async () => {
    const port = await listen(tls.createServer({ key, cert }, (s) => s.on("data", (d) => s.write(`secure:${d}`))));
    const sock = connect({ hostname: "localhost", port }, { secureTransport: "on", tls: { ca: cert } });
    const writer = sock.writable.getWriter();
    await writer.write(new TextEncoder().encode("hi"));
    expect(text((await sock.readable.getReader().read()).value!)).toBe("secure:hi");
    await sock.close();
    // The same server with no trust in its certificate is refused.
    const refused = connect({ hostname: "localhost", port }, { secureTransport: "on" });
    await expect(refused.opened).rejects.toThrow(/self[- ]signed|unable to verify/i);
  });

  it("upgrades a plain connection with STARTTLS", async () => {
    const port = await listen(
      net.createServer((s) => {
        s.write("* READY\r\n");
        s.once("data", () => {
          s.write("OK\r\n");
          const secure = new tls.TLSSocket(s, { isServer: true, key, cert });
          secure.on("data", (d) => secure.write(String(d).toUpperCase()));
        });
      }),
    );
    let sock = connect({ hostname: "localhost", port }, { secureTransport: "starttls", tls: { ca: cert } });
    let reader = sock.readable.getReader();
    let writer = sock.writable.getWriter();
    expect(text((await reader.read()).value!)).toBe("* READY\r\n");
    await writer.write(new TextEncoder().encode("STARTTLS\r\n"));
    expect(text((await reader.read()).value!)).toBe("OK\r\n");
    // What the callers do: drop the plain reader, then continue on the secure socket.
    await reader.cancel();
    sock = sock.startTls();
    reader = sock.readable.getReader();
    writer = sock.writable.getWriter();
    await writer.write(new TextEncoder().encode("hello"));
    expect(text((await reader.read()).value!)).toBe("HELLO");
    await sock.close();
  });

  it("ends the stream when the server hangs up, and reports a refused connection", async () => {
    const port = await listen(net.createServer((s) => s.end("bye")));
    const sock = connect({ hostname: "127.0.0.1", port });
    const reader = sock.readable.getReader();
    expect(text((await reader.read()).value!)).toBe("bye");
    expect((await reader.read()).done).toBe(true);
    const dead = connect({ hostname: "127.0.0.1", port: 1 });
    await expect(dead.opened).rejects.toThrow(/ECONNREFUSED/);
  });
});
