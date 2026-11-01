import { PNG } from "pngjs";
import { takeSnapshot } from "./snapshot.mjs";

// Identical PNG bytes necessarily contain identical pixels. Decode only when
// encoded bytes differ; metadata/compression differences still use strict RGBA.
export function compareCaptures(reference, candidate) {
	if (reference.tiles || candidate.tiles) {
		const size = (capture) =>
			capture.tiles
				? [capture.width, capture.height]
				: (() => {
						const png = PNG.sync.read(capture.bytes);
						return [png.width, png.height];
					})();
		const a = size(reference),
			b = size(candidate);
		if (a[0] !== b[0] || a[1] !== b[1])
			return { equal: false, reason: "dimensions", reference: a, candidate: b };
		if (reference.tiles.length !== candidate.tiles.length)
			throw Error("Inconsistent tile coverage");
		let differentPixels = 0,
			differentTile;
		for (let i = 0; i < reference.tiles.length; i++) {
			const left = reference.tiles[i],
				right = candidate.tiles[i];
			if (left.y !== right.y) throw Error("Inconsistent tile coordinates");
			if (left.bytes.equals(right.bytes)) continue;
			const compared = comparePixels(PNG.sync.read(left.bytes), PNG.sync.read(right.bytes));
			if (compared.reason === "dimensions") throw Error("Inconsistent tile dimensions");
			differentPixels += compared.differentPixels;
			if (!compared.equal && differentTile === undefined) differentTile = i;
		}
		return {
			equal: differentPixels === 0,
			differentPixels,
			totalPixels: a[0] * a[1],
			differentTile,
			...(differentPixels ? { reason: "pixels" } : {}),
		};
	}
	if (reference.bytes.equals(candidate.bytes)) return { equal: true, differentPixels: 0 };
	reference.png ??= PNG.sync.read(reference.bytes);
	candidate.png ??= PNG.sync.read(candidate.bytes);
	return comparePixels(reference.png, candidate.png);
}

export function comparePixels(reference, candidate) {
	if (reference.width !== candidate.width || reference.height !== candidate.height)
		return {
			equal: false,
			reason: "dimensions",
			reference: [reference.width, reference.height],
			candidate: [candidate.width, candidate.height],
		};
	if (reference.data.equals(candidate.data)) return { equal: true, differentPixels: 0 };
	let differentPixels = 0;
	for (let i = 0; i < reference.data.length; i += 4) {
		if (
			reference.data[i] !== candidate.data[i] ||
			reference.data[i + 1] !== candidate.data[i + 1] ||
			reference.data[i + 2] !== candidate.data[i + 2] ||
			reference.data[i + 3] !== candidate.data[i + 3]
		)
			differentPixels++;
	}
	return {
		equal: false,
		reason: "pixels",
		differentPixels,
		totalPixels: reference.width * reference.height,
	};
}

export async function captureStableFrames(capture, { wait, now = () => performance.now() }) {
	let previous = await capture();
	let stableSince = now(),
		stableFrames = 0,
		comparisons = 0;
	do {
		await wait(100);
		const current = await capture();
		comparisons++;
		if (compareCaptures(previous, current).equal) stableFrames++;
		else {
			stableSince = now();
			stableFrames = 0;
		}
		previous = current;
		if (stableFrames >= 2 && now() - stableSince >= 500) return { stable: true, capture: current };
		// Bound observation attempts rather than image-generation time. The caller
		// enforces the overall deadline, including slow tiled captures.
	} while (comparisons < 100);
	return { stable: false, capture: previous };
}

export async function capturePage(page, url, { clockTime } = {}) {
	const clock = /\/features\/mfm\//.test(url) || !/\/(docs|blog)\//.test(url);
	const errors = [];
	const pendingLocalRequests = new Set();
	page.on("request", (request) => {
		if (new URL(request.url()).hostname === "127.0.0.1") pendingLocalRequests.add(request);
	});
	page.on("requestfinished", (request) => pendingLocalRequests.delete(request));
	page.on("requestfailed", (request) => pendingLocalRequests.delete(request));
	const report = (message) => {
		if (errors.length < 20) errors.push(String(message).slice(0, 1000));
	};
	page.on("pageerror", (error) => report(error.message));
	page.on("console", (message) => {
		if (/hydration/i.test(message.text())) report(message.text());
	});
	page.on("response", (response) => {
		if (new URL(response.url()).hostname === "127.0.0.1" && response.status() >= 400)
			report(`${response.status()} ${response.url()}`);
	});
	try {
		if (clock) await page.clock.install({ time: new Date(clockTime ?? Date.now()) });
		const response = await page.goto(url, {
			waitUntil: "load",
			timeout: 20_000,
		});
		if (response?.status() !== 200) throw new Error("HTTP " + response?.status());
		if (clock)
			await page.evaluate(() => {
				const request = window.requestAnimationFrame.bind(window);
				window.requestAnimationFrame = (callback) => request(() => callback(30_000));
			});
		await page.waitForSelector('html[data-site-ready="true"]', {
			state: "attached",
			timeout: 8000,
		});
		// A client-only tool can request its chunk after the root mounts.
		const requestDeadline = Date.now() + 5000;
		while (pendingLocalRequests.size && Date.now() < requestDeadline) await page.waitForTimeout(50);
		await page.evaluate(async () => {
			document.querySelectorAll("img").forEach((img) => {
				img.loading = "eager";
			});
			await document.fonts.ready;
			await Promise.allSettled(
				[...document.images]
					.filter(
						(img) =>
							img.getAttribute("src") &&
							new URL(img.src, location.href).hostname === location.hostname,
					)
					.map((img) => img.decode()),
			);
		});
		// Compare decoded video pixels at the same authored frame, without masks.
		await page.evaluate(async () => {
			await Promise.all(
				[...document.querySelectorAll("video")].map(async (video) => {
					video.pause();
					if (video.readyState < 2) {
						await new Promise((resolve, reject) => {
							if (video.error) return reject(new Error("Video failed: " + video.currentSrc));
							video.addEventListener("loadeddata", resolve, { once: true });
							video.addEventListener(
								"error",
								() => reject(new Error("Video failed: " + video.currentSrc)),
								{ once: true },
							);
						});
					}
					if (video.currentTime !== 0) {
						await new Promise((resolve) => {
							video.addEventListener("seeked", resolve, { once: true });
							video.currentTime = 0;
						});
					}
				}),
			);
		});
		// Root hydration does not await descendant async fetch/import callbacks.
		// The offline fixture has no polling endpoints; wait for all initial work.
		await page.waitForLoadState("networkidle", { timeout: 60000 });
		// Let layout/IntersectionObserver callbacks update the docs TOC before
		// pausing time. Freezing the application clock too early races scrollspy.
		// Use an absolute clock for deterministic WebGL shader timestamps as well.
		await page.waitForTimeout(200);
		// Sample finite motion at its end and infinite motion at its initial frame for
		// current and subsequently mounted elements, retaining every visible element.
		const infiniteFrames = await page.evaluate(() => {
			const names = new Map();
			for (const animation of document.getAnimations()) {
				if (!animation.animationName || animation.effect?.getTiming().iterations !== Infinity)
					continue;
				const frame = animation.effect.getKeyframes()[0];
				const properties = Object.entries(frame).filter(
					([key]) => !["offset", "computedOffset", "easing", "composite"].includes(key),
				);
				const declarations = properties
					.map(
						([key, value]) =>
							`${key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())}:${value};`,
					)
					.join("");
				names.set(
					animation.animationName,
					`@keyframes ${CSS.escape(animation.animationName)} { from {${declarations}} to {${declarations}} }`,
				);
			}
			return [...names.values()].join("\n");
		});
		await page.addStyleTag({
			content: `
      ${infiniteFrames}
      input, textarea, [contenteditable] { caret-color: transparent !important; }
      *, *::before, *::after {
        animation-timeline: auto !important;
        animation-duration: 0.001s !important;
        animation-delay: -0.001s !important;
        animation-iteration-count: 1 !important;
        animation-fill-mode: both !important;
        animation-play-state: paused !important;
        transition: none !important;
      }
    `,
		});
		if (clock) {
			await page.clock.pauseAt(new Date(clockTime).getTime() + 29_968);
			// Run two frames with identical RAF timestamps. Pausing Date alone can
			// retain a different last shader frame depending on navigation timing.
			await page.clock.runFor(32);
		}
		await page.mouse.move(0, 0);
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
		// Preserve the chosen authored frame as ordinary CSS, then cancel CSS
		// animation so opacity/transform layers cannot retain animated surfaces.
		const motionRules = await page.evaluate(() => {
			const rules = [];
			const metadata = new Set(["offset", "computedOffset", "easing", "composite"]);
			for (const animation of document.getAnimations()) {
				if (!animation.animationName || !animation.effect?.target) continue;
				const effect = animation.effect,
					target = effect.target;
				const properties = new Set(
					effect
						.getKeyframes()
						.flatMap((frame) => Object.keys(frame).filter((key) => !metadata.has(key))),
				);
				const computed = getComputedStyle(target, effect.pseudoElement ?? null);
				const declaration = document.createElement("div").style;
				for (const key of properties) {
					const property = key.startsWith("--")
						? key
						: key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
					declaration.setProperty(property, computed.getPropertyValue(property), "important");
				}
				const parts = [];
				for (let node = target; node; node = node.parentElement) {
					const siblings = node.parentElement
						? [...node.parentElement.children].filter(
								(sibling) =>
									sibling.localName === node.localName &&
									sibling.namespaceURI === node.namespaceURI,
							)
						: [node];
					parts.unshift(`${CSS.escape(node.localName)}:nth-of-type(${siblings.indexOf(node) + 1})`);
				}
				rules.push(`${parts.join(" > ")}${effect.pseudoElement ?? ""} { ${declaration.cssText} }`);
			}
			return rules.join("\n");
		});
		await page.addStyleTag({
			content: `*, *::before, *::after { animation: none !important; transition: none !important; }\n${motionRules}`,
		});

		await page.evaluate(async () => {
			await document.fonts.ready;
		});

		if (errors.length)
			return {
				status: "runtime-error",
				errors,
				finalPath: new URL(page.url()).pathname,
			};
		const { stable, capture: previous } = await captureStableFrames(() => takeSnapshot(page), {
			wait: (ms) => page.waitForTimeout(ms),
		});
		if (!stable)
			return {
				status: "unstable",
				errors: [
					"Frames did not stabilize after at least three captures and a 500ms stable interval",
				],
			};
		return {
			status: errors.length ? "runtime-error" : "captured",
			errors,
			...previous,
			finalPath: new URL(page.url()).pathname,
		};
	} catch (error) {
		return {
			status: "capture-error",
			errors: [
				error.message,
				...errors,
				...[...pendingLocalRequests].map(
					(request) => `Pending ${request.resourceType()} ${request.url()}`,
				),
			],
		};
	}
}

export async function createFixtureContext(browser, options = {}) {
	const context = await browser.newContext({
		viewport: options.viewport ?? { width: 1440, height: 900 },
		locale: options.locale ?? "en-US",
		timezoneId: "Asia/Tokyo",
		colorScheme: options.colorScheme ?? "light",
		reducedMotion: "reduce",
		serviceWorkers: "block",
	});
	await context.route("**/*", (route) =>
		new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
	);
	await context.addInitScript((colorScheme) => {
		if (window !== window.top) return;
		localStorage.setItem("miHub_io_emoji", JSON.stringify({ emojis: [] }));
		localStorage.setItem("nuxt-color-mode", colorScheme);
		localStorage.setItem("miHub_aichan_mode", "false");
		// Reproducible client-side randomness for static/canvas examples as well.
		let state = 0x12345678;
		Math.random = () => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return (state >>> 0) / 4294967296;
		};
	}, options.colorScheme ?? "light");
	return context;
}
