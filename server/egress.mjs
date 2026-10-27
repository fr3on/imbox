// Stops the server fetching from its own machine or a private network, whatever name was used to ask. src/api/netguard.ts judges the name;
// this judges the address the name turns into, which is the only check a name that resolves somewhere private cannot get past. It runs when the
// connection is made, so a redirect or a name that changes its answer between lookups is held to it too.

import dns from "node:dns";
import net from "node:net";
import { Agent, setGlobalDispatcher } from "undici";

const blocked = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
]) blocked.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["2002::", 16], ["64:ff9b::", 96]]) blocked.addSubnet(net6, bits, "ipv6");

/** True when an address is this machine, a private or link-local range (the cloud metadata address included), or otherwise not a public one. */
export function isPrivateAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  const type = net.isIP(address);
  if (!type) return true;
  if (type === 6 && !/^[23]/i.test(address.replace(/^0+/, ""))) return true; // only 2000::/3 is handed out as public
  return blocked.check(address, type === 4 ? "ipv4" : "ipv6");
}

export class PrivateAddressError extends Error {
  constructor(host, address) {
    super(`${host} resolves to ${address}, a private address`);
    this.code = "EPRIVATE";
  }
}

let allowedHosts = new Set();

/** A dns.lookup that fails when any answer is private. Takes the same arguments dns.lookup does, as a socket connect option. */
export function guardedLookup(host, options, callback, allowed = allowedHosts) {
  const lookup = allowed.has(host.toLowerCase()) ? dns.lookup : checked;
  lookup(host, options, callback);
}

function checked(host, options, callback) {
  dns.lookup(host, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new PrivateAddressError(host, bad.address));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Makes every fetch in this process use the guarded lookup. EGRESS_ALLOW_HOSTS is a comma-separated list of host names that may be private (a
 * local Ollama, for the custom model address); ALLOW_PRIVATE_EGRESS=1 turns the guard off.
 */
export function installEgressGuard(env = process.env) {
  if (env.ALLOW_PRIVATE_EGRESS === "1") return false;
  allowedHosts = new Set((env.EGRESS_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
  setGlobalDispatcher(new Agent({ connect: { lookup: guardedLookup } }));
  return true;
}
