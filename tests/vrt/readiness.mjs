// External requests are deliberately blocked by the offline fixture. Readiness
// depends on initial local fetch/import work, after fonts/images/video decode.
export async function waitForLocalIdle({
	pending,
	lastActivity,
	wait,
	now = () => performance.now(),
}) {
	const deadline = now() + 60000;
	while (pending() || now() - lastActivity() < 500) {
		if (now() >= deadline) throw Error("Initial local requests did not settle within 60 seconds");
		await wait(50);
	}
}
