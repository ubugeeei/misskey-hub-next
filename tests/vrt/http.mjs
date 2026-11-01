// Serve the same static bytes as a production host, including media byte ranges.
export function sendStaticResponse(request, response, bytes, headers = {}) {
	const common = { ...headers, "Accept-Ranges": "bytes", "Content-Length": bytes.length };
	const range =
		request.method === "GET" && !request.headers["if-range"] ? request.headers.range : undefined;
	if (!range) {
		response.writeHead(200, common);
		response.end(bytes);
		return;
	}
	const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
	// Multiple/unknown range formats may be ignored by an HTTP server.
	if (!match) {
		response.writeHead(200, common);
		response.end(bytes);
		return;
	}
	let start = match[1] ? Number(match[1]) : 0;
	let end = match[2] ? Number(match[2]) : bytes.length - 1;
	if (!match[1] && match[2]) {
		start = Math.max(0, bytes.length - Number(match[2]));
		end = bytes.length - 1;
	}
	end = Math.min(end, bytes.length - 1);
	if ((!match[1] && !match[2]) || start >= bytes.length || start > end) {
		response.writeHead(416, {
			...common,
			"Content-Range": `bytes */${bytes.length}`,
			"Content-Length": 0,
		});
		response.end();
		return;
	}
	response.writeHead(206, {
		...common,
		"Content-Range": `bytes ${start}-${end}/${bytes.length}`,
		"Content-Length": end - start + 1,
	});
	response.end(bytes.subarray(start, end + 1));
}
