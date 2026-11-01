import {chromium} from "@playwright/test";
import {PNG} from "pngjs";
import {mkdir,writeFile} from "node:fs/promises";
const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255]];
const browser=await chromium.launch({args:["--enable-begin-frame-control","--disable-threaded-scrolling","--disable-new-content-rendering-timeout","--disable-lcd-text","--disable-partial-raster","--run-all-compositor-stages-before-draw","--disable-gpu-compositing","--force-color-profile=srgb","--disable-threaded-animation"]});
const results=[];
const root=await browser.newBrowserCDPSession();
try {
 for(const controlled of [false,true]) {
  const row={controlled};let context;
  try {
   const previous=(await root.send("Target.getBrowserContexts")).browserContextIds;
   context=await browser.newContext({viewport:{width:390,height:844},screen:{width:800,height:600}});
   let page;
   if(controlled) {
    const ids=(await root.send("Target.getBrowserContexts")).browserContextIds.filter(id=>!previous.includes(id));
    if(ids.length!==1)throw Error("Ambiguous fresh browser context");
    const created=context.waitForEvent("page",{timeout:10000});
    await root.send("Target.createTarget",{url:"about:blank",browserContextId:ids[0],enableBeginFrameControl:true,width:390,height:844});
    page=await created;
   }else page=await context.newPage();
   page.setDefaultTimeout(10000);
   const session=await context.newCDPSession(page);
   await page.setContent(`<style>html,body{margin:0}.band{height:2000px}#fixed{position:fixed;left:0;bottom:0;width:1px;height:1px;background:rgb(4,5,6)}#vh{position:fixed;right:0;top:0;width:1px;height:100vh;background:rgb(1,2,3)}</style>${colors.map(c=>`<div class="band" style="background:rgb(${c.join(",")})"></div>`).join("")}<div id="fixed"></div><div id="vh"></div>`);
   row.firstFrame=await session.send("HeadlessExperimental.beginFrame",{noDisplayUpdates:false});
   let done=false,capture,error;
   const pending=session.send("Page.captureScreenshot",{format:"png",optimizeForSpeed:true,captureBeyondViewport:true,fromSurface:true,clip:{x:0,y:0,width:390,height:10000,scale:1}}).then(value=>{capture=value;done=true;},reason=>{error=reason;done=true;});
   row.frames=0;
   while(!done&&row.frames<120){await page.waitForTimeout(16);await session.send("HeadlessExperimental.beginFrame",{noDisplayUpdates:false});row.frames++;}
   if(!done)throw Error("Capture did not finish under controlled frames");
   await pending;if(error)throw error;
   const png=PNG.sync.read(Buffer.from(capture.data,"base64"));row.dimensions=[png.width,png.height];
   if(png.width!==390||png.height!==10000)throw Error("Wrong image dimensions");
   let different=0,first;
   for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++) {
    let expected=colors[Math.floor(y/2000)];if(x===389&&y<844)expected=[1,2,3];if(x===0&&y===843)expected=[4,5,6];
    const i=(y*png.width+x)*4;
    if(png.data[i]!==expected[0]||png.data[i+1]!==expected[1]||png.data[i+2]!==expected[2]||png.data[i+3]!==255){different++;first??={x,y,actual:[...png.data.subarray(i,i+4)],expected};}
   }
   row.pixels=png.width*png.height;row.different=different;row.first=first;row.pass=!different;
  }catch(error){row.error=error.message;row.pass=false;}
  finally{await context?.close();}
  results.push(row);console.log(JSON.stringify(row));
 }
}finally{await browser.close();await mkdir("output/playwright",{recursive:true});await writeFile("output/playwright/beginframe-contract.json",JSON.stringify(results,null,2));}
if(results.some(row=>!row.pass))process.exitCode=1;
