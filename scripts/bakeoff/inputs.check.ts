import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { downscaleImage } from "./inputs.ts";

test("an image above 2 MP becomes a 1,600 px JPEG", async () => {
  const input = await downscaleImage(createCanvas(3000, 2000).toBuffer("image/png"), "image/png");
  assert.equal(input.downscaled, true);
  assert.equal(input.contentType, "image/jpeg");
  assert.deepEqual([input.width, input.height], [1600, 1067]);
  const decoded = await loadImage(input.bytes);
  assert.deepEqual([decoded.width, decoded.height], [1600, 1067]);
});

test("a small image is sent as it is", async () => {
  const bytes = createCanvas(400, 900).toBuffer("image/png");
  const input = await downscaleImage(bytes, "image/png");
  assert.equal(input.downscaled, false);
  assert.equal(input.contentType, "image/png");
  assert.ok(input.bytes.equals(bytes));
  assert.deepEqual([input.width, input.height], [400, 900]);
});
