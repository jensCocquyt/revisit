import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectImageType } from "../src/screenshots/image-type.js";

describe("detectImageType", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)("recognises %s by its bytes", async (format) => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } })
      .toFormat(format)
      .toBuffer();
    expect(detectImageType(bytes)).toBe(`image/${format}`);
  });

  it("rejects anything else", () => {
    expect(detectImageType(Buffer.from("%PDF-1.7"))).toBeUndefined();
    expect(detectImageType(Buffer.from("RIFF0000WAVE"))).toBeUndefined();
    expect(detectImageType(new Uint8Array())).toBeUndefined();
  });
});
