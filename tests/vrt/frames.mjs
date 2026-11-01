export const fixtureBrowserArgs = [
	"--enable-unsafe-swiftshader",
	"--disable-lcd-text",
	"--disable-partial-raster",
	"--run-all-compositor-stages-before-draw",
	"--disable-gpu-compositing",
	"--force-color-profile=srgb",
	"--disable-threaded-animation",
];

// Linux headless-shell frame control keeps image decode and display commits
// ordered while CDP temporarily expands its surface for an offscreen clip.
export const frameControlArgs = [
	"--disable-threaded-scrolling",
	"--disable-new-content-rendering-timeout",
	"--enable-begin-frame-control",
];

export async function readPhysicalScreen(browser) {
	const context = await browser.newContext({ viewport: null });
	try {
		const page = await context.newPage();
		return await page.evaluate(() => ({ width: screen.width, height: screen.height }));
	} finally {
		await context.close();
	}
}

const controllers = new WeakMap();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function startFrameControl(page) {
	if (process.env.VRT_CONTROLLED_FRAMES !== "1") return;
	const session = await page.context().newCDPSession(page);
	let running = true,
		failure;
	const frame = (noDisplayUpdates) =>
		session.send("HeadlessExperimental.beginFrame", { noDisplayUpdates });
	await frame(true);
	// Permit initial loading/layout without committing a display frame. Capture
	// pauses this pump, then explicitly advances each decode/screenshot operation.
	const pump = (async () => {
		while (running) {
			await frame(true);
			await delay(16);
		}
	})().catch((error) => {
		failure = error;
	});
	const controller = {
		async pause() {
			running = false;
			await pump;
			if (failure) throw failure;
		},
		async drive(action, noDisplayUpdates) {
			let done = false,
				value,
				error;
			const pending = Promise.resolve()
				.then(action)
				.then(
					(result) => {
						value = result;
						done = true;
					},
					(reason) => {
						error = reason;
						done = true;
					},
				);
			const deadline = performance.now() + 60000;
			while (!done && performance.now() < deadline) {
				await delay(16);
				if (!done) await frame(noDisplayUpdates);
			}
			if (!done) throw Error("Controlled frame operation exceeded 60 seconds");
			await pending;
			if (error) throw error;
			return value;
		},
		async close() {
			running = false;
			await pump;
			controllers.delete(page);
			await session.detach().catch(() => {});
		},
	};
	controllers.set(page, controller);
	return controller;
}
export function withFrameProgress(page, action, noDisplayUpdates = false) {
	const controller = controllers.get(page);
	return controller ? controller.drive(action, noDisplayUpdates) : action();
}
