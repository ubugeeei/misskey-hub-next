import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { sendStaticResponse } from "./http.mjs";

test("Static fixture serves complete files and HEAD with an explicit byte length", async (t) => {
	const server = createServer((req, res) =>
		sendStaticResponse(req, res, Buffer.from("0123456789"), { "Content-Type": "video/mp4" }),
	);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const url = `http://127.0.0.1:${server.address().port}/movie.mp4`;
	const full = await fetch(url);
	assert.equal(full.status, 200);
	assert.equal(full.headers.get("content-length"), "10");
	assert.equal(full.headers.get("accept-ranges"), "bytes");
	assert.equal(await full.text(), "0123456789");
	const head = await fetch(url, { method: "HEAD", headers: { Range: "bytes=3-6" } });
	assert.equal(head.status, 200);
	assert.equal(head.headers.get("content-length"), "10");
	assert.equal(await head.text(), "");
});
test("Media range requests receive only the requested bytes and correct status", async (t) => {
	const server = createServer((req, res) =>
		sendStaticResponse(req, res, Buffer.from("0123456789"), { "Content-Type": "video/mp4" }),
	);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const url = `http://127.0.0.1:${server.address().port}/movie.mp4`;
	for (const [range, body, contentRange] of [
		["bytes=3-6", "3456", "bytes 3-6/10"],
		["bytes=7-", "789", "bytes 7-9/10"],
		["bytes=-3", "789", "bytes 7-9/10"],
		["bytes=8-100", "89", "bytes 8-9/10"],
	]) {
		const response = await fetch(url, { headers: { Range: range } });
		assert.equal(response.status, 206);
		assert.equal(response.headers.get("content-range"), contentRange);
		assert.equal(response.headers.get("content-length"), String(body.length));
		assert.equal(response.headers.get("content-type"), "video/mp4");
		assert.equal(await response.text(), body);
	}
	const unavailable = await fetch(url, { headers: { Range: "bytes=10-" } });
	assert.equal(unavailable.status, 416);
	assert.equal(unavailable.headers.get("content-range"), "bytes */10");
	assert.equal(await unavailable.text(), "");
});
