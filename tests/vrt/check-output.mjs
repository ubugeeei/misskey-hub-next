import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [referenceArg, candidateArg] = process.argv.slice(2);
assert.ok(referenceArg && candidateArg, "Pass reference and candidate public directories");
const reference = resolve(referenceArg),
	candidate = resolve(candidateArg);
const manifest = async (root) =>
	JSON.parse(await readFile(resolve(root, ".vite/manifest.json"), "utf8"));
const [before, after] = await Promise.all([manifest(reference), manifest(candidate)]);
const entry = "ssg/client.ts";
assert.ok(before[entry]?.isEntry && after[entry]?.isEntry, "Missing actual client entry");
const script = (file) => `<script type="module" src="/${file}"></script>`;
const referenceScript = script(before[entry].file),
	candidateScript = script(after[entry].file);
const htmlFiles = async (root) =>
	(await readdir(root, { recursive: true })).filter((file) => file.endsWith(".html")).sort();
const [referenceHtml, candidateHtml] = await Promise.all([
	htmlFiles(reference),
	htmlFiles(candidate),
]);
assert.deepEqual(candidateHtml, referenceHtml, "Published HTML file set changed");
for (const file of referenceHtml) {
	const [left, right] = await Promise.all([
		readFile(resolve(reference, file), "utf8"),
		readFile(resolve(candidate, file), "utf8"),
	]);
	// Only the actual entry script may differ. CSS URLs, text, attributes, inline
	// data, redirect targets and all other bytes remain part of the comparison.
	assert.ok(left.replaceAll(referenceScript, candidateScript) === right, `HTML differs: ${file}`);
}
let publicFiles = 0;
for (const file of await readdir("public", { recursive: true })) {
	if (!(await stat(resolve("public", file))).isFile()) continue;
	const [left, right] = await Promise.all([
		readFile(resolve(reference, file)),
		readFile(resolve(candidate, file)),
	]);
	assert.ok(left.equals(right), `Public asset differs: ${file}`);
	publicFiles++;
}
const receipt = {
	htmlFiles: referenceHtml.length,
	publicFiles,
	actualReferenceEntry: before[entry].file,
	actualCandidateEntry: after[entry].file,
	policy: "Exact HTML except the actual client entry script URL; exact public asset bytes",
};
console.log(JSON.stringify(receipt));
await writeFile(".vrt/output-parity.json", JSON.stringify(receipt, null, 2) + "\n");
