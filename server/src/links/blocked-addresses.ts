import net from "node:net";

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

const blockedIpv4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

// BlockList checks IPv4-mapped addresses against the IPv4 rules. NAT64, 6to4 and Teredo
// also embed IPv4 but are not mapped, so they are blocked outright.
const blockedIpv6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blockList = new net.BlockList();
for (const [network, prefix] of blockedIpv4) blockList.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of blockedIpv6) blockList.addSubnet(network, prefix, "ipv6");
