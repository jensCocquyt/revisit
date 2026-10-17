import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "../src/links/blocked-addresses.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "2002:a00:1::",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "93.184.215.14",
    "8.8.8.8",
    "::ffff:8.8.8.8",
    "2606:4700::1111",
    "2a00:1450:4001::200e",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("blocks anything that is not an address", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
  });
});
