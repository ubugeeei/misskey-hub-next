import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createFrozenFetch } from "./frozen-fetch.mjs";
const url = "https://example.com/contributors";
const body = Buffer.from('{"contributors":[{"username":"雪","contributions":927}]}');
const responses = {
	[url]: {
		status: 200,
		headers: [["content-type", "application/json"]],
		body: body.toString("base64"),
		sha256: createHash("sha256").update(body).digest("hex"),
	},
};

test("Both build consumers receive independent responses with identical bytes", async () => {
	const fetch = createFrozenFetch(responses);
	for (const input of [url, new URL(url), new Request(url)]) {
		const response = await fetch(input);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "application/json");
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
	}
});
test("Missing inputs and mutations fail instead of contacting the live network", async () => {
	const fetch = createFrozenFetch(responses);
	await assert.rejects(fetch("https://example.com/other"), /Unrecorded/);
	await assert.rejects(fetch(url, { method: "POST", body: "unexpected" }), /recorded GET/);
});
test("Frozen inputs retain cancellation and reject corrupted response bytes", async () => {
	const fetch = createFrozenFetch(responses);
	await assert.rejects(fetch(url, { signal: AbortSignal.abort() }), { name: "AbortError" });
	assert.throws(
		() =>
			createFrozenFetch({
				[url]: { ...responses[url], body: Buffer.from("changed").toString("base64") },
			}),
		/checksum mismatch/,
	);
});
