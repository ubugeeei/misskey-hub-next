import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCoverage } from "./coverage.mjs";

const paths = ["/a/", "/b/"];
const options = { referenceCommit: "a".repeat(40), shardCount: 2 };
function fixtures() {
	return [1440, 390].flatMap((width) =>
		["light", "dark"].flatMap((colorScheme) =>
			paths.map((path, index) => ({
				manifest: {
					viewport: { width, height: width === 1440 ? 900 : 844 },
					colorScheme,
					sample: "all",
					scopeSize: paths.length,
					referenceCommit: options.referenceCommit,
					pages: [path],
					shard: `${index + 1}/2`,
					sourceFingerprint: "source",
					scriptHash: "script",
					captureSettings: "controlled-frames/native-screen",
					rendererFingerprint: "same-browser-args-and-physical-screen",
					referenceOutputFingerprint: "reference",
					candidateOutputFingerprint: "candidate",
					benchmarkSha256: "metadata",
					browserVersion: "145",
					locale: "en-US",
					clockTime: "2026-11-01T00:00:00Z",
				},
				summary: { finished: true, processed: 1 },
				rows: [
					{
						path,
						reference: { status: "captured", errors: [] },
						results: {
							baseline: { status: "passed" },
							migrated: { status: "passed", equal: true },
						},
					},
				],
			})),
		),
	);
}
test("All URLs must pass in every viewport and theme", () => {
	assert.deepEqual(
		validateCoverage(fixtures(), paths, options).map((row) => row.passed),
		[2, 2, 2, 2],
	);
});
test("A missing CI shard cannot produce a passing full-site result", () => {
	assert.throws(() => validateCoverage(fixtures().slice(1), paths, options), /Missing VRT shard/);
});
test("Duplicate URLs across shards cannot stand in for missing URLs", () => {
	const reports = fixtures();
	reports[1].manifest.pages = ["/a/"];
	reports[1].rows[0].path = "/a/";
	assert.throws(() => validateCoverage(reports, paths, options), /duplicate URL across shards/);
});
test("Unavailable references remain failures", () => {
	const reports = fixtures();
	reports[0].rows[0].reference.status = "runtime-error";
	assert.throws(() => validateCoverage(reports, paths, options), /reference failed/);
});
test("A one-pixel difference remains a failure", () => {
	const reports = fixtures();
	reports[0].rows[0].results.migrated = { status: "different", equal: false, differentPixels: 1 };
	assert.throws(() => validateCoverage(reports, paths, options), /candidate failed/);
});
test("Mixed site artifacts cannot produce a passing result", () => {
	const reports = fixtures();
	reports[0].manifest.candidateOutputFingerprint = "other";
	assert.throws(
		() => validateCoverage(reports, paths, options),
		/different candidateOutputFingerprint/,
	);
});

test("Mixed frame-control settings cannot establish reproducible coverage", () => {
	const reports = fixtures();
	reports[1].manifest.captureSettings = "automatic-frames/viewport-screen";
	assert.throws(() => validateCoverage(reports, paths, options), /different captureSettings/);
});

test("Different physical screen or browser arguments cannot be mixed across shards", () => {
	const reports = fixtures();
	reports[1].manifest.rendererFingerprint = "different-screen";
	assert.throws(() => validateCoverage(reports, paths, options), /different rendererFingerprint/);
});
