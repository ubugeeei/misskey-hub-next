import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function createFrozenFetch(responses) {
	for (const response of Object.values(responses))
		assert.equal(
			createHash("sha256").update(Buffer.from(response.body, "base64")).digest("hex"),
			response.sha256,
			"Frozen HTTP body checksum mismatch",
		);
	return async (input, init) => {
		const request = new Request(input, init);
		request.signal.throwIfAborted();
		assert.equal(request.method, "GET", "VRT build inputs only permit recorded GET requests");
		const response = responses[request.url];
		assert.ok(response, `Unrecorded VRT build request: ${request.url}`);
		return new Response(Buffer.from(response.body, "base64"), {
			status: response.status,
			headers: response.headers,
		});
	};
}

if (process.env.VRT_BUILD_INPUTS) {
	const inputs = JSON.parse(await readFile(process.env.VRT_BUILD_INPUTS, "utf8"));
	assert.equal(inputs.version, 1, "Unknown VRT build input format");
	globalThis.fetch = createFrozenFetch(inputs.responses);
}
