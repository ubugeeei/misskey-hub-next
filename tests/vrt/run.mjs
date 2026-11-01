import { createServer } from "node:http";
import { sendStaticResponse } from "./http.mjs";
import { readFile, writeFile, appendFile, mkdir, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { sourceFingerprint, outputFingerprint } from "./evidence.mjs";
import { loadPages } from "../../ssg/routes.mjs";
import { capturePage, compareCaptures, createFixtureContext } from "./capture.mjs";

const option = (name, fallback) =>
	process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sample = option("sample", "all");
const viewport =
	option("viewport", "desktop") === "mobile"
		? { width: 390, height: 844 }
		: { width: 1440, height: 900 };
const colorScheme = option("theme", "light");
if (!["light", "dark"].includes(colorScheme)) throw Error("Invalid color scheme");
const outputDirectory = option("output-dir", ".vrt/results");
const workers = Number(option("workers", "1"));
if (![1, 2, 4, 6, 8].includes(workers)) throw Error("Invalid worker count");
const modes = ["baseline", "migrated"];
const allPages = await loadPages();
const selected =
	sample === "30" ? JSON.parse(await readFile("tests/vrt/pages.json", "utf8")) : null;
let pages = selected ? allPages.filter((page) => selected.includes(page.path)) : allPages;
const only = option("only", "").split(",").filter(Boolean);
if (only.length) pages = pages.filter((page) => only.includes(page.path));
// Exercise each kind of surface early without reducing the full URL scope.
const priorityPaths = [
	"/ja/docs/for-users/features/note/",
	"/ja/docs/for-users/features/mfm/",
	"/ja/docs/for-users/stepped-guides/how-to-enable-2fa/",
	"/ja/blog/2021-09-11-hello-to-misskey-hub/",
	"/ja/",
	"/ja/about-us/team/",
	"/ja/tools/share-link-generator/",
	"/",
	"/about-us/",
];
const rank = (page) => {
	const index = priorityPaths.indexOf(page.path);
	return index < 0 ? priorityPaths.length : index;
};
pages.sort((a, b) => rank(a) - rank(b));
const limit = Number(option("limit", String(pages.length)));
pages = pages.slice(0, limit);
const scopeSize = pages.length;
const shard = option("shard", "1/1");
if (!/^\d+\/\d+$/.test(shard)) throw Error("Invalid shard; use 1/4 through 4/4");
const [shardIndex, shardCount] = shard.split("/").map(Number);
if (shardIndex < 1 || shardIndex > shardCount || shardCount > 16) throw Error("Invalid shard");
pages = pages.filter((_, index) => index % shardCount === shardIndex - 1);
if (!pages.length) throw Error("No VRT pages selected");
await mkdir(outputDirectory, { recursive: true });
const rowFile = resolve(outputDirectory, "vrt-rows.jsonl");
const summaryFile = resolve(outputDirectory, "vrt.json");
const manifestFile = resolve(outputDirectory, "vrt-run.json");
const startedAt = new Date().toISOString();
const sourceBefore = await sourceFingerprint();
const benchmarkFile = resolve(option("reference-metadata", ".vrt/baseline-build.json"));
const benchmark = JSON.parse(await readFile(benchmarkFile, "utf8"));
const referenceDirectory = resolve(
	option(
		"reference-dir",
		resolve(benchmark.baselineDirectory ?? ".vrt/reference", ".output/public"),
	),
);
const candidateDirectory = resolve(option("candidate-dir", ".output/public"));
const scriptHash = createHash("sha256")
	.update(await readFile(new URL(import.meta.url)))
	.update(await readFile(new URL("./capture.mjs", import.meta.url)))
	.update(await readFile(new URL("./snapshot.mjs", import.meta.url)))
	.update(await readFile(new URL("./http.mjs", import.meta.url)))
	.digest("hex");
const manifest = {
	startedAt,
	sourceFingerprint: sourceBefore,
	sample,
	pages: pages.map((page) => page.path),
	modes,
	workers,
	shard,
	scopeSize,
	scriptHash,
	baselineDirectory: referenceDirectory,
	referenceCommit: benchmark.commit ?? benchmark.baselineCommit,
	candidateDirectory,
	referenceOutputFingerprint: await outputFingerprint(referenceDirectory),
	candidateOutputFingerprint: await outputFingerprint(candidateDirectory),
	clockTime: benchmark?.finishedAt ?? startedAt,
	benchmarkFile: benchmark ? benchmarkFile : undefined,
	referenceBuild: benchmark,
	runnerNode: process.version,
	benchmarkSha256: benchmark
		? createHash("sha256")
				.update(await readFile(benchmarkFile))
				.digest("hex")
		: undefined,
	viewport,
	colorScheme,
	renderer: "Chromium with SwiftShader WebGL fallback",
	isolation:
		"Fresh browser context per URL and compiler variant; one capture at a time per browser; no cookies, clock or storage carry over",
	locale: benchmark.intlLocale ?? "en-US",
	timezone: "Asia/Tokyo",
	policy:
		"Exact decoded RGBA and dimensions, at least three identical frames spanning 500ms; up to 100 sampled comparisons 100ms apart, with screenshot generation excluded from the observation budget, no masks/tolerance. Offline external network; empty emoji cache; seeded client randomness; frozen MFM/static clocks at absolute reference clock +30 seconds, RAF timestamps fixed to 30000ms and two final frames advanced for deterministic shader phase; CSS finite motion uses its final frame and infinite motion its initial frame. Those authored properties are retained as ordinary CSS before CSS animation is canceled, including scroll-linked and subsequently mounted elements. Every page uses 4096px CDP clips at unchanged document coordinates; all pixels compared, no scrolling or masks. Capture deadline 300s. Browser Intl fallback matches the build; video is decoded and paused at time zero; LCD subpixel text and partial raster are disabled; all compositor stages complete before drawing, software compositing and sRGB are fixed. Initial descendant requests reach network idle before CSS state is frozen.",
};
const rows = [];
if (process.argv.includes("--resume")) {
	const previous = JSON.parse(await readFile(manifestFile, "utf8"));
	if (
		previous.sourceFingerprint !== sourceBefore ||
		previous.shard !== manifest.shard ||
		previous.locale !== manifest.locale ||
		previous.scriptHash !== scriptHash ||
		previous.benchmarkSha256 !== manifest.benchmarkSha256 ||
		previous.referenceOutputFingerprint !== manifest.referenceOutputFingerprint ||
		previous.candidateOutputFingerprint !== manifest.candidateOutputFingerprint ||
		JSON.stringify(previous.modes) !== JSON.stringify(manifest.modes) ||
		JSON.stringify(previous.viewport) !== JSON.stringify(manifest.viewport) ||
		previous.colorScheme !== manifest.colorScheme ||
		JSON.stringify(previous.pages) !== JSON.stringify(manifest.pages)
	)
		throw new Error("Cannot resume with changed capture code or URL scope");
	manifest.startedAt = previous.startedAt;
	rows.push(
		...(await readFile(rowFile, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line)),
	);
} else {
	await writeFile(rowFile, "");
	await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
}
const completed = new Set(rows.map((row) => row.path));
const remaining = pages.filter((page) => !completed.has(page.path));
const mime = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ico": "image/x-icon",
	".wasm": "application/wasm",
	".gif": "image/gif",
	".avif": "image/avif",
	".mp4": "video/mp4",
};
const servers = [],
	origins = {};
let browser;
let cursor = 0;
const sampleCounts = {},
	maxSamplesPerKind = 1;
let summaryWrite = Promise.resolve();
async function saveSummary(finished = false) {
	const summary = modes.map((mode) => {
		const counts = {};
		for (const row of rows) {
			const status = row.results[mode].status;
			counts[status] = (counts[status] ?? 0) + 1;
		}
		const passed = counts.passed ?? 0;
		const unavailable = counts["reference-unavailable"] ?? 0;
		return {
			mode,
			total: pages.length,
			processed: rows.length,
			passed,
			passRatePercent: (passed / pages.length) * 100,
			comparable: pages.length - unavailable,
			comparablePassRatePercent:
				pages.length === unavailable ? null : (passed / (pages.length - unavailable)) * 100,
			counts,
		};
	});
	const contents =
		JSON.stringify(
			{
				...manifest,
				pages: pages.length,
				updatedAt: new Date().toISOString(),
				finished,
				processed: rows.length,
				referenceUnavailable: rows.filter((row) => row.reference.status !== "captured").length,
				summary,
			},
			null,
			2,
		) + "\n";
	summaryWrite = summaryWrite.then(() => writeFile(summaryFile, contents));
	await summaryWrite;
}
async function saveSamples(mode, entry, reference, candidate, comparison) {
	const tile = comparison?.differentTile ?? 0;
	const referenceBytes = reference.bytes ?? reference.tiles?.[tile]?.bytes;
	const candidateBytes = candidate.bytes ?? candidate.tiles?.[tile]?.bytes;
	const key = mode + "/" + entry.kind;
	if ((sampleCounts[key] ?? 0) >= maxSamplesPerKind || !referenceBytes || !candidateBytes) return;
	sampleCounts[key] = (sampleCounts[key] ?? 0) + 1;
	const dir = resolve(
		outputDirectory,
		"samples",
		mode,
		createHash("sha256").update(entry.path).digest("hex").slice(0, 12),
	);
	await mkdir(dir, { recursive: true });
	await writeFile(dir + "/baseline.png", referenceBytes);
	await writeFile(dir + "/candidate.png", candidateBytes);
	if (reference.tiles)
		await writeFile(
			dir + "/tile.json",
			JSON.stringify({
				y: reference.tiles[tile].y,
				width: reference.width,
				pageHeight: reference.height,
			}) + "\n",
		);
	return dir;
}
try {
	for (const mode of modes) {
		const root = mode === "baseline" ? referenceDirectory : candidateDirectory;
		await stat(root);
		const server = createServer(async (req, res) => {
			try {
				let file = resolve(
					root,
					"." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
				);
				if (file !== root && !file.startsWith(root + sep)) throw new Error("Invalid path");
				if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
				const bytes = await readFile(file);
				sendStaticResponse(req, res, bytes, {
					"Content-Type": mime[extname(file)] ?? "application/octet-stream",
					"Cache-Control": extname(file) === ".html" ? "no-cache" : "public,max-age=3600",
				});
			} catch {
				res.writeHead(404);
				res.end("Not found");
			}
		});
		await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
		servers.push(server);
		origins[mode] = `http://127.0.0.1:${server.address().port}`;
	}
	manifest.browserArgs = [
		"--enable-unsafe-swiftshader",
		"--disable-lcd-text",
		"--disable-partial-raster",
		"--run-all-compositor-stages-before-draw",
		"--disable-gpu-compositing",
		"--force-color-profile=srgb",
		"--disable-threaded-animation",
	];
	browser = await chromium.launch({ args: manifest.browserArgs });
	manifest.browserVersion = browser.version();
	await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
	console.log(
		`[full-vrt] ${pages.length} URLs, ${modes.length} modes, ${workers} workers; ${remaining.length} URLs remaining`,
	);
	await Promise.all(
		Array.from({ length: workers }, async (_, worker) => {
			while (cursor < remaining.length) {
				const entry = remaining[cursor++];
				const capture = async (mode) => {
					const context = await createFixtureContext(browser, {
						viewport,
						colorScheme,
						locale: manifest.locale,
					});
					const page = await context.newPage();
					let timer;
					try {
						return await Promise.race([
							capturePage(page, origins[mode] + entry.path, {
								clockTime: manifest.clockTime,
							}),
							new Promise((accept) => {
								timer = setTimeout(
									() =>
										accept({
											status: "capture-error",
											errors: ["Overall capture timeout: 300 seconds"],
										}),
									300_000,
								);
							}),
						]);
					} finally {
						clearTimeout(timer);
						await context.close();
					}
				};
				const reference = await capture("baseline");
				const results = {
					baseline: {
						status: reference.status === "captured" ? "passed" : "reference-unavailable",
						errors: reference.errors,
					},
				};
				for (const mode of modes.slice(1)) {
					if (reference.status !== "captured") {
						const candidate = await capture(mode);
						results[mode] = {
							status: "reference-unavailable",
							candidateStatus: candidate.status,
							errors: candidate.errors,
						};
						continue;
					}
					const candidate = await capture(mode);
					if (candidate.status !== "captured") {
						results[mode] = {
							status: candidate.status,
							errors: candidate.errors,
						};
						continue;
					}
					const pixels = compareCaptures(reference, candidate);
					results[mode] = {
						status: pixels.equal ? "passed" : "different",
						...pixels,
						finalPath: candidate.finalPath,
					};
					if (!pixels.equal)
						results[mode].sampleDirectory = await saveSamples(
							mode,
							entry,
							reference,
							candidate,
							pixels,
						);
				}
				const row = {
					path: entry.path,
					kind: entry.kind,
					reference: {
						status: reference.status,
						errors: reference.errors,
						finalPath: reference.finalPath,
					},
					results,
				};
				rows.push(row);
				await appendFile(rowFile, JSON.stringify(row) + "\n");
				if (rows.length % 10 === 0 || rows.length === pages.length) {
					await saveSummary();
					console.log(
						`[full-vrt] ${rows.length}/${pages.length} URLs complete; baseline unavailable ${rows.filter((row) => row.reference.status !== "captured").length}; worker ${worker}`,
					);
				}
			}
		}),
	);
	if ((await sourceFingerprint()) !== sourceBefore)
		throw Error("Build/capture sources changed during VRT");
	if (
		(await outputFingerprint(referenceDirectory)) !== manifest.referenceOutputFingerprint ||
		(await outputFingerprint(candidateDirectory)) !== manifest.candidateOutputFingerprint
	)
		throw Error("Site output changed during VRT");
	await saveSummary(true);
	console.table(
		JSON.parse(await readFile(summaryFile, "utf8")).summary.map(
			({ mode, passed, total, passRatePercent, counts }) => ({
				mode,
				passed,
				total,
				percent: passRatePercent.toFixed(2),
				counts: JSON.stringify(counts),
			}),
		),
	);
	if (rows.length !== pages.length || rows.some((row) => row.results.migrated.status !== "passed"))
		process.exitCode = 1;
} finally {
	await browser?.close();
	await Promise.all(servers.map((server) => new Promise((accept) => server.close(accept))));
}
