import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const allPaths = ["/ja/docs/releases/"];
const outcomes = [];
for (let repeat = 1; repeat <= 1; repeat++) {
  const paths = repeat === 1 ? allPaths : allPaths.filter(path => !path.endsWith("/releases/"));
  for (const comparison of ["unchanged-reference", "optimized"]) {
    const output = `output/playwright/${comparison}-${repeat}`;
    const args = ["tests/vrt/run.mjs", "--workers=2", `--only=${paths.join(",")}`,
      "--reference-metadata=.vrt/reference-build.json", "--reference-dir=.vrt/reference/.output/public",
      `--viewport=${process.env.CONTROL_VIEWPORT}`, `--theme=${process.env.CONTROL_THEME}`,
      `--output-dir=${output}`];
    if (comparison === "unchanged-reference") args.push("--candidate-dir=.vrt/reference/.output/public");
    const result = spawnSync(process.execPath, args, { stdio: "inherit", timeout: 900000 });
    outcomes.push({ repeat, comparison, status: result.status, error: result.error?.message, signal: result.signal });
  }
}
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/control-outcomes.json", JSON.stringify(outcomes, null, 2) + "\n");
if (outcomes.some(row => row.status !== 0)) process.exitCode = 1;
