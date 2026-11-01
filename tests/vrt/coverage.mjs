import assert from "node:assert/strict";

export function validateCoverage(reports, expectedPaths, { referenceCommit, shardCount = 4 }) {
	assert.equal(reports.length, 4 * shardCount, "Missing VRT shard reports");
	const expected = new Set(expectedPaths);
	assert.equal(expected.size, expectedPaths.length, "Duplicate expected URL");
	const groups = new Map();
	const shared = new Map();
	for (const { manifest, summary, rows } of reports) {
		const viewport =
			manifest.viewport.width === 1440 && manifest.viewport.height === 900
				? "desktop"
				: manifest.viewport.width === 390 && manifest.viewport.height === 844
					? "mobile"
					: undefined;
		assert.ok(viewport, "Unknown viewport");
		assert.ok(["light", "dark"].includes(manifest.colorScheme), "Unknown theme");
		const condition = viewport + "/" + manifest.colorScheme;
		assert.equal(
			manifest.sample,
			"all",
			condition + ": sampled VRT cannot establish full coverage",
		);
		assert.equal(manifest.scopeSize, expected.size, condition + ": wrong full URL scope");
		assert.equal(manifest.referenceCommit, referenceCommit, condition + ": wrong reference commit");
		assert.equal(summary.finished, true, condition + ": unfinished capture");
		assert.equal(summary.processed, rows.length, condition + ": incomplete summary");
		assert.equal(manifest.pages.length, rows.length, condition + ": missing URL rows");
		for (const key of [
			"sourceFingerprint",
			"scriptHash",
			"captureSettings",
			"rendererFingerprint",
			"referenceOutputFingerprint",
			"candidateOutputFingerprint",
			"benchmarkSha256",
			"browserVersion",
			"locale",
			"clockTime",
		]) {
			assert.ok(manifest[key], "Missing " + key);
			if (!shared.has(key)) shared.set(key, manifest[key]);
			assert.equal(manifest[key], shared.get(key), "VRT shards used different " + key);
		}
		const [index, count] = manifest.shard.split("/").map(Number);
		assert.equal(count, shardCount, condition + ": wrong shard count");
		assert.ok(index >= 1 && index <= count && Number.isInteger(index), "Invalid shard index");
		let group = groups.get(condition);
		if (!group) groups.set(condition, (group = { shards: new Set(), paths: new Set() }));
		assert.ok(!group.shards.has(index), condition + ": duplicate shard");
		group.shards.add(index);
		const assigned = new Set(manifest.pages);
		assert.equal(assigned.size, rows.length, condition + ": duplicate assigned URL");
		for (const row of rows) {
			assert.ok(assigned.delete(row.path), condition + ": duplicate or unassigned row " + row.path);
			assert.ok(expected.has(row.path), condition + ": unexpected URL " + row.path);
			assert.ok(
				!group.paths.has(row.path),
				condition + ": duplicate URL across shards " + row.path,
			);
			assert.equal(
				row.reference.status,
				"captured",
				condition + ": reference failed for " + row.path,
			);
			assert.equal(
				row.results.baseline.status,
				"passed",
				condition + ": reference failed for " + row.path,
			);
			assert.equal(
				row.results.migrated.status,
				"passed",
				condition + ": candidate failed for " + row.path,
			);
			assert.equal(
				row.results.migrated.equal,
				true,
				condition + ": unequal pixels for " + row.path,
			);
			assert.equal(row.reference.errors?.length ?? 0, 0, condition + ": reference runtime errors");
			group.paths.add(row.path);
		}
	}
	assert.equal(groups.size, 4, "Missing viewport/theme conditions");
	return [...groups].map(([condition, group]) => {
		assert.equal(group.shards.size, shardCount, condition + ": missing shards");
		assert.equal(group.paths.size, expected.size, condition + ": missing URLs");
		return { condition, passed: group.paths.size, total: expected.size };
	});
}
