import { createBuildFetch } from "../ssg/build/fetch-cache.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignLanes, preparePayloads } from "../ssg/build/payloads.mjs";
import { parseMdc, parseMdcContent, mdcDocument } from "../nuxt-compat/mdc.ts";

test("Shared Japanese FAQ graphs retain their original render order", () => {
	const pages = [
		{ locale: "ja-ks", path: "/ja-ks/contact/" },
		{ locale: "en", path: "/en/" },
		{ locale: "ja", path: "/ja/contact/" },
	];
	const lanes = assignLanes(pages, 2);
	assert.ok(lanes.some((lane) => JSON.stringify(lane) === JSON.stringify([0, 2])));
	assert.deepEqual(lanes.flat().sort(), [0, 1, 2]);
});

test("Merged locale groups keep original page order with fewer workers", () => {
	const pages = [
		{ locale: "it" },
		{ locale: "fr" },
		{ locale: "ja-ks" },
		{ locale: "it" },
		{ locale: "ja" },
		{ locale: "it" },
	];
	assert.deepEqual(assignLanes(pages, 1), [[0, 1, 2, 3, 4, 5]]);
	for (const lane of assignLanes(pages, 2)) {
		assert.ok(lane.every((index, position) => position === 0 || lane[position - 1] < index));
	}
});

test("Payload trimming retains aliases that acquire rendered related HTML", () => {
	const shared = { title: "FAQ", body: { children: [] } };
	const pages = [
		{
			kind: "docs",
			document: { content: "used" },
			related: [shared],
			surround: [null, shared],
			inlineMarkdown: { used: { value: 1 }, unused: { value: 2 } },
		},
	];
	const [result] = preparePayloads(pages);
	result.related[0].html = "prepared";
	assert.equal(result.surround[1].html, "prepared");
	assert.deepEqual(result.inlineMarkdown, { used: { value: 1 } });
});

test("Reused MDC processors isolate heading sluggers across documents", async () => {
	const first = await parseMdc("# Duplicate\n\n## Duplicate\n", "first.md");
	const second = await parseMdc("# Duplicate\n\n## Duplicate\n", "second.md");
	assert.deepEqual(
		first.body.children.map((node) => node.props?.id),
		second.body.children.map((node) => node.props?.id),
	);
});

test("Shared parsed content gets independent source metadata and mutable trees", async () => {
	const content = await parseMdcContent("# Shared\n\n[Link](../page.md)\n");
	const first = mdcDocument(structuredClone(content), "en/shared.md");
	const second = mdcDocument(structuredClone(content), "ja/shared.md");
	assert.equal(first._id, "content:en:shared.md");
	assert.equal(second._id, "content:ja:shared.md");
	first.body.children[0].props.id = "changed";
	assert.equal(second.body.children[0].props.id, "shared");
});

test("Concurrent renderer fetches share a single response", async () => {
	let calls = 0;
	const fetchJson = createBuildFetch(async () => {
		calls++;
		return { ok: true, json: async () => ({ contributors: ["fixture"] }) };
	});
	const result = await Promise.all([
		fetchJson("https://example.test/contributors"),
		fetchJson("https://example.test/contributors"),
	]);
	assert.equal(calls, 1);
	assert.deepEqual(result, [{ contributors: ["fixture"] }, { contributors: ["fixture"] }]);
});

test("Failed upstream responses reject every waiting renderer", async () => {
	const fetchJson = createBuildFetch(async () => ({ ok: false, status: 503 }));
	await assert.rejects(fetchJson("https://example.test/unavailable"), /Full SSG fetch 503/);
	await assert.rejects(fetchJson("https://example.test/unavailable"), /Full SSG fetch 503/);
});
