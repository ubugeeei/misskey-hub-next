// Capture every CSS pixel without scrolling. Very long release histories exceed
// 130,000px; a single decoded PNG can occupy >700MB. CDP clips preserve the same
// document coordinates (including fixed elements) while bounding decode memory.
export async function takeSnapshot(page) {
	const session = await page.context().newCDPSession(page);
	try {
		const { cssContentSize } = await session.send("Page.getLayoutMetrics");
		const width = Math.ceil(cssContentSize.width),
			height = Math.ceil(cssContentSize.height),
			tiles = [];
		const tileSize = process.env.VRT_RASTER_VARIANT?.includes("fullclip") ? 16384 : 4096;
		for (let y = 0; y < height; y += tileSize) {
			const tileHeight = Math.min(tileSize, height - y);
			const { data } = await session.send("Page.captureScreenshot", {
				format: "png",
				optimizeForSpeed: true,
				captureBeyondViewport: true,
				fromSurface: true,
				clip: { x: 0, y, width, height: tileHeight, scale: 1 },
			});
			tiles.push({ y, bytes: Buffer.from(data, "base64") });
		}
		return { width, height, tiles };
	} finally {
		await session.detach();
	}
}
