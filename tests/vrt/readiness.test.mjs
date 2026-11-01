import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForLocalIdle } from "./readiness.mjs";

test("Local readiness requires a quiet interval", async () => {
	let time = 0;
	await waitForLocalIdle({
		pending: () => 0,
		lastActivity: () => 0,
		now: () => time,
		wait: async (ms) => {
			time += ms;
		},
	});
	assert.ok(time >= 500);
});
test("A late descendant import restarts the local quiet interval", async () => {
	let time = 0,
		pending = 0,
		activity = 0;
	await waitForLocalIdle({
		pending: () => pending,
		lastActivity: () => activity,
		now: () => time,
		wait: async (ms) => {
			time += ms;
			if (time === 200) {
				pending = 1;
				activity = time;
			}
			if (time === 400) {
				pending = 0;
				activity = time;
			}
		},
	});
	assert.ok(time >= 900);
	assert.equal(pending, 0);
});
test("An unfinished local request fails within the readiness deadline", async () => {
	let time = 0;
	await assert.rejects(
		waitForLocalIdle({
			pending: () => 1,
			lastActivity: () => 0,
			now: () => time,
			wait: async (ms) => {
				time += ms;
			},
		}),
		/did not settle/,
	);
	assert.ok(time <= 60000);
});
