import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

// Fetch live build inputs once, before either timed build. Both unmodified
// reference and candidate receive these exact response bytes through a preload.
const url = "https://ungh.cc/repos/misskey-dev/misskey/contributors";
const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200, "Contributor input request failed");
const body = Buffer.from(await response.arrayBuffer());
assert.ok(Array.isArray(JSON.parse(body).contributors), "Invalid contributor input");
const headers = [...response.headers].filter(
	([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name),
);
await writeFile(
	process.argv[2],
	JSON.stringify(
		{
			version: 1,
			capturedAt: new Date().toISOString(),
			responses: {
				[url]: {
					status: response.status,
					headers,
					body: body.toString("base64"),
					sha256: createHash("sha256").update(body).digest("hex"),
				},
			},
		},
		null,
		2,
	) + "\n",
);
