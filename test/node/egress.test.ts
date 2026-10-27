import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress, guardedLookup } from "../../server/egress.mjs";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.0.0.5", "172.16.1.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "2002:7f00:1::", "not an address"])("refuses %s", (a) => {
    expect(isPrivateAddress(a)).toBe(true);
  });
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (a) => {
    expect(isPrivateAddress(a)).toBe(false);
  });
});

describe("guardedLookup", () => {
  const lookup = (host: string) => new Promise<{ err: any; addr?: any }>((res) => guardedLookup(host, {}, (err: any, addr: any) => res({ err, addr })));

  it("refuses a name that resolves to this machine", async () => {
    const { err } = await lookup("localhost");
    expect(err?.code).toBe("EPRIVATE");
  });

  it("refuses an address written as the host", async () => {
    const { err } = await lookup("169.254.169.254");
    expect(err?.code).toBe("EPRIVATE");
  });

  it("lets a host through that the owner named", async () => {
    const { installEgressGuard } = await import("../../server/egress.mjs");
    const { getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
    const before = getGlobalDispatcher();
    installEgressGuard({ EGRESS_ALLOW_HOSTS: "localhost" });
    const srv = http.createServer((_, r) => r.end("ok"));
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
    try {
      const r = await fetch(`http://localhost:${(srv.address() as AddressInfo).port}/`);
      expect(await r.text()).toBe("ok");
    } finally {
      setGlobalDispatcher(before);
      srv.close();
    }
  });

  it("stops a fetch to a local server, redirects included", async () => {
    const { installEgressGuard } = await import("../../server/egress.mjs");
    const { getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
    const before = getGlobalDispatcher();
    installEgressGuard({});
    const srv = http.createServer((_, r) => r.end("secret"));
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
    afterAll(() => srv.close());
    try {
      await expect(fetch(`http://localhost:${(srv.address() as AddressInfo).port}/`)).rejects.toThrow();
    } finally {
      setGlobalDispatcher(before);
    }
  });
});
