import {spawnSync} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
const paths=["/ja/about-us/history/","/ja-ks/about-us/history/","/id/docs/for-admin/install/guides/docker/","/pl/docs/for-admin/install/guides/kubernetes/","/cn/docs/for-developers/api/streaming/channel/main/","/docs/for-admin/features/announcement/","/cn/docs/for-users/features/mfm/","/ja-ks/docs/releases/"];
const outcomes=[];
for(let repeat=1;repeat<=8;repeat++) for(const comparison of ["unchanged-reference","optimized"]) {
 const selected=repeat===1?paths:paths.filter(p=>!p.endsWith("/releases/"));
 const args=["tests/vrt/run.mjs","--workers=1",`--only=${selected.join(",")}`,"--reference-metadata=.vrt/reference-build.json","--reference-dir=.vrt/reference/.output/public",`--viewport=${process.env.CONTROL_VIEWPORT}`,`--theme=${process.env.CONTROL_THEME}`,`--output-dir=output/playwright/${comparison}-${repeat}`];
 if(comparison==="unchanged-reference")args.push("--candidate-dir=.vrt/reference/.output/public");
 const result=spawnSync(process.execPath,args,{stdio:"inherit",timeout:1200000});outcomes.push({repeat,comparison,status:result.status,error:result.error?.message,signal:result.signal});
}
await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/control-outcomes.json",JSON.stringify(outcomes,null,2));
if(outcomes.some(r=>r.status!==0))process.exitCode=1;
