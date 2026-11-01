import {chromium} from "@playwright/test";
import {PNG} from "pngjs";
import {mkdir,writeFile} from "node:fs/promises";
const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255]];
const browser=await chromium.launch({args:["--disable-lcd-text","--disable-partial-raster","--run-all-compositor-stages-before-draw","--disable-gpu-compositing","--force-color-profile=srgb","--disable-threaded-animation"]});
const results=[];
const metrics=page=>page.evaluate(()=>({inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio,screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],scroll:[scrollX,scrollY],visual:[visualViewport.width,visualViewport.height,visualViewport.offsetLeft,visualViewport.offsetTop,visualViewport.scale],fixed:document.querySelector("#fixed").getBoundingClientRect().toJSON(),vh:document.querySelector("#vh").getBoundingClientRect().toJSON()}));
try {
 for(const method of ["baseline","visible-override","visible-size"]) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const row={method};
  try {
   await page.setContent(`<style>html,body{margin:0}.band{height:2000px}#fixed{position:fixed;left:0;bottom:0;width:1px;height:1px;background:rgb(4,5,6)}#vh{position:fixed;right:0;top:0;width:1px;height:100vh;background:rgb(1,2,3)}</style>${colors.map(c=>`<div class="band" style="background:rgb(${c.join(",")})"></div>`).join("")}<div id="fixed"></div><div id="vh"></div>`);
   row.before=await metrics(page);
   const session=await context.newCDPSession(page);
   if(method!=="baseline") {
    await session.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false,screenWidth:390,screenHeight:844,dontSetVisibleSize:method==="visible-size",viewport:{x:0,y:0,width:390,height:10000,scale:1}});
    if(method==="visible-size")await session.send("Emulation.setVisibleSize",{width:390,height:10000});
    await page.waitForTimeout(100);
   }
   row.afterSetup=await metrics(page);
   const {data}=await session.send("Page.captureScreenshot",{format:"png",optimizeForSpeed:true,captureBeyondViewport:method==="baseline",fromSurface:true,clip:{x:0,y:0,width:390,height:10000,scale:1}});
   await page.waitForTimeout(100);
   row.afterCapture=await metrics(page);
   const png=PNG.sync.read(Buffer.from(data,"base64"));row.dimensions=[png.width,png.height];
   if(png.width!==390||png.height!==10000)throw Error("Wrong image dimensions");
   row.changedMetrics=JSON.stringify(row.before)!==JSON.stringify(row.afterSetup)||JSON.stringify(row.before)!==JSON.stringify(row.afterCapture);
   let different=0,first;
   for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++) {
    let expected=colors[Math.floor(y/2000)];
    if(x===389&&y<844)expected=[1,2,3];
    if(x===0&&y===843)expected=[4,5,6];
    const i=(y*png.width+x)*4;
    if(png.data[i]!==expected[0]||png.data[i+1]!==expected[1]||png.data[i+2]!==expected[2]||png.data[i+3]!==255){different++;first??={x,y,actual:[...png.data.subarray(i,i+4)],expected};}
   }
   row.pixels=png.width*png.height;row.different=different;row.first=first;row.pass=!different&&!row.changedMetrics;
   await session.detach();
  }catch(error){row.error=error.message;row.pass=false;}
  finally{await context.close();}
  results.push(row);console.log(JSON.stringify(row));
 }
}finally{await browser.close();await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/viewport-contract.json",JSON.stringify(results,null,2));}
if(results.some(row=>!row.pass))process.exitCode=1;
