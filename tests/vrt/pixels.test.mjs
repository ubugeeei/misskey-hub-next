import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { compareCaptures, captureStableFrames } from "./capture.mjs";
const image = (changed = false) => {
	const png = new PNG({ width: 3, height: 2 });
	png.data.fill(255);
	if (changed) png.data[png.data.length - 4] = 254;
	return PNG.sync.write(png);
};
const capture = (changed = false) => ({
	width: 3,
	height: 4,
	tiles: [
		{ y: 0, bytes: image() },
		{ y: 2, bytes: image(changed) },
	],
});
test("Tiled comparison accepts identical pixels", () =>
	assert.equal(compareCaptures(capture(), capture()).equal, true));
test("Tiled comparison checks the last pixel of the last tile", () => {
	const result = compareCaptures(capture(), capture(true));
	assert.equal(result.equal, false);
	assert.equal(result.differentPixels, 1);
	assert.equal(result.differentTile, 1);
	assert.equal(result.totalPixels, 12);
});
test("Tiled comparison rejects changed page dimensions", () =>
	assert.equal(compareCaptures(capture(), { ...capture(), height: 5 }).reason, "dimensions"));
test("Single-image comparison checks exact RGBA", () =>
	assert.equal(compareCaptures({ bytes: image() }, { bytes: image(true) }).differentPixels, 1));

test("Slow tiled captures still obtain the three required identical frames", async () => {
	let time = 0,
		calls = 0;
	const result = await captureStableFrames(
		async () => {
			time += 15000;
			calls++;
			return capture();
		},
		{
			now: () => time,
			wait: async (ms) => {
				time += ms;
			},
		},
	);
	assert.equal(result.stable, true);
	assert.equal(calls, 3);
});
test("Slow captures with a changing pixel remain unstable", async () => {
	let time = 0,
		calls = 0;
	const result = await captureStableFrames(
		async () => {
			time += 15000;
			return capture(++calls % 2 === 0);
		},
		{
			now: () => time,
			wait: async (ms) => {
				time += ms;
			},
		},
	);
	assert.equal(result.stable, false);
	assert.ok(calls <= 101);
});
test("Fast identical frames must span the minimum stable interval", async () => {
	let time = 0,
		calls = 0;
	const result = await captureStableFrames(
		async () => {
			calls++;
			return capture();
		},
		{
			now: () => time,
			wait: async (ms) => {
				time += ms;
			},
		},
	);
	assert.equal(result.stable, true);
	assert.ok(time >= 500);
	assert.ok(calls >= 3);
});

test("Slow captures may settle after an initial repaint", async () => {
	let time = 0,
		calls = 0;
	const result = await captureStableFrames(
		async () => {
			time += 15000;
			return capture(++calls > 1);
		},
		{
			now: () => time,
			wait: async (ms) => {
				time += ms;
			},
		},
	);
	assert.equal(result.stable, true);
	assert.ok(calls >= 4);
});
