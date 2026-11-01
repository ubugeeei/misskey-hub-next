import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import {
	fixtureBrowserArgs,
	frameControlArgs,
	readPhysicalScreen,
	startFrameControl,
} from "./frames.mjs";
import { takeSnapshot } from "./snapshot.mjs";

assert.equal(
	process.env.VRT_CONTROLLED_FRAMES,
	"1",
	"Run this contract in the pinned Linux frame-control fixture",
);
const browser = await chromium.launch({ args: [...fixtureBrowserArgs, ...frameControlArgs] });
try {
	const screen = await readPhysicalScreen(browser);
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1440, height: 900 },
	]) {
		const context = await browser.newContext({ viewport, screen });
		let frames;
		try {
			const page = await context.newPage();
			frames = await startFrameControl(page);
			const colors = [
				[255, 0, 0],
				[0, 255, 0],
				[0, 0, 255],
				[255, 255, 0],
				[255, 0, 255],
			];
			await page.setContent(
				`<style>html,body{margin:0}.band{height:2000px}#fixed{position:fixed;left:0;bottom:0;width:1px;height:1px;background:rgb(4,5,6)}#vh{position:fixed;right:0;top:0;width:1px;height:100vh;background:rgb(1,2,3)}</style>${colors.map((c) => `<div class="band" style="background:rgb(${c.join(",")})"></div>`).join("")}<div id="fixed"></div><div id="vh"></div>`,
			);
			const metrics = () =>
				page.evaluate(() => ({
					inner: [innerWidth, innerHeight],
					outer: [outerWidth, outerHeight],
					dpr: devicePixelRatio,
					screen: [
						window.screen.width,
						window.screen.height,
						window.screen.availWidth,
						window.screen.availHeight,
						window.screen.orientation.type,
						window.screen.orientation.angle,
					],
					scroll: [scrollX, scrollY],
					visual: [
						visualViewport.width,
						visualViewport.height,
						visualViewport.offsetLeft,
						visualViewport.offsetTop,
						visualViewport.scale,
					],
					fixed: document.querySelector("#fixed").getBoundingClientRect().toJSON(),
					vh: document.querySelector("#vh").getBoundingClientRect().toJSON(),
				}));
			const before = await metrics();
			await frames.pause();
			for (let repeat = 0; repeat < 3; repeat++) {
				const snapshot = await takeSnapshot(page);
				assert.equal(snapshot.width, viewport.width);
				assert.equal(snapshot.height, 10000);
				let different = 0,
					first;
				for (const tile of snapshot.tiles) {
					const png = PNG.sync.read(tile.bytes);
					for (let y = 0; y < png.height; y++)
						for (let x = 0; x < png.width; x++) {
							const absoluteY = tile.y + y;
							let expected = colors[Math.floor(absoluteY / 2000)];
							if (x === viewport.width - 1 && absoluteY < viewport.height) expected = [1, 2, 3];
							if (x === 0 && absoluteY === viewport.height - 1) expected = [4, 5, 6];
							const i = (y * png.width + x) * 4;
							if (
								png.data[i] !== expected[0] ||
								png.data[i + 1] !== expected[1] ||
								png.data[i + 2] !== expected[2] ||
								png.data[i + 3] !== 255
							) {
								different++;
								first ??= { x, y: absoluteY, actual: [...png.data.subarray(i, i + 4)], expected };
							}
						}
				}
				assert.equal(different, 0, JSON.stringify(first));
				assert.deepEqual(
					await metrics(),
					before,
					"Capture changed viewport, physical screen, scrolling or fixed/VH geometry",
				);
			}
			console.log(
				`Frame contract: ${viewport.width}x10000, every pixel and viewport metric checked in three full tiled captures`,
			);
		} finally {
			await frames?.close();
			await context.close();
		}
	}
} finally {
	await browser.close();
}
