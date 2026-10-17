import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareForModel } from "../src/screenshots/read-screenshot.js";

describe("prepareForModel", () => {
  it("shrinks a large screenshot so its longest edge fits the model", async () => {
    const prepared = await prepareForModel(await image(3000, 2000));
    const { width, height } = await sharp(Buffer.from(prepared.base64, "base64")).metadata();
    expect([width, height]).toEqual([1568, 1045]);
  });

  it("leaves a small screenshot at its size", async () => {
    const prepared = await prepareForModel(await image(800, 600));
    const { width, height } = await sharp(Buffer.from(prepared.base64, "base64")).metadata();
    expect([width, height]).toEqual([800, 600]);
    expect(prepared.mediaType).toBe("image/png");
  });
});

async function image(width: number, height: number) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .jpeg()
    .toBuffer();
  return { bytes, mediaType: "image/jpeg" };
}
