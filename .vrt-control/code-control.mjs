import {spawnSync} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
const outcomes=[];
for(let repeat=1;repeat<=8;repeat++) for(const comparison of ["unchanged-reference","optimized"]) {
 const args=["tests/vrt/run.mjs","--workers=1","--only=/id/docs/for-admin/install/guides/docker/,/pl/docs/for-admin/install/guides/kubernetes/","--reference-metadata=.vrt/reference-build.json","--reference-dir=.vrt/reference/.output/public","--viewport=mobile","--theme=light",`--output-dir=output/playwright/${comparison}-${repeat}`];
 if(comparison==="unchanged-reference")args.push("--candidate-dir=.vrt/reference/.output/public");
 const result=spawnSync(process.execPath,args,{stdio:"inherit",timeout:900000});outcomes.push({repeat,comparison,status:result.status,error:result.error?.message,signal:result.signal});
}
await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/control-outcomes.json",JSON.stringify(outcomes,null,2));
if(outcomes.some(r=>r.status!==0))process.exitCode=1;
