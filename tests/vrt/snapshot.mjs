import { withFrameProgress } from "./frames.mjs";

// Capture every CSS pixel through the same CDP path without scrolling or
// per-screenshot DOM changes. Very long release histories exceed
// 130,000px; a single decoded PNG can occupy >700MB. CDP clips preserve the same
// document coordinates (including fixed elements) while bounding decode memory.
export async function takeSnapshot(page) {
	const session = await page.context().newCDPSession(page);
	try {
		const { cssContentSize } = await session.send("Page.getLayoutMetrics");
		const width = Math.ceil(cssContentSize.width),
			height = Math.ceil(cssContentSize.height),
			tiles = [];
		for (let y = 0; y < height; y += 4096) {
			const tileHeight = Math.min(4096, height - y);
			if (process.env.VRT_CONTROLLED_FRAMES === "1")
				await withFrameProgress(
					page,
					() =>
						page.evaluate(async () => {
							await Promise.all(
								[...document.images]
									.filter(
										(img) =>
											img.currentSrc &&
											img.naturalWidth &&
											new URL(img.currentSrc).origin === location.origin &&
											/\.jpe?g$/i.test(new URL(img.currentSrc).pathname),
									)
									.map((img) => img.decode()),
							);
						}),
					true,
				);
			const { data } = await withFrameProgress(page, () =>
				session.send("Page.captureScreenshot", {
					format: "png",
					optimizeForSpeed: true,
					captureBeyondViewport: true,
					fromSurface: true,
					clip: { x: 0, y, width, height: tileHeight, scale: 1 },
				}),
			);
			tiles.push({ y, bytes: Buffer.from(data, "base64") });
		}
		return { width, height, tiles };
	} finally {
		await session.detach();
	}
}
