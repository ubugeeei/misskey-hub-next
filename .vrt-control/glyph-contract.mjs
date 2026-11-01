import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {PNG} from 'pngjs';
import {fixtureBrowserArgs,frameControlArgs,readPhysicalScreen,startFrameControl} from '../tests/vrt/frames.mjs';
import {takeSnapshot} from '../tests/vrt/snapshot.mjs';
const browser=await chromium.launch({args:[...fixtureBrowserArgs,...frameControlArgs]});
try {
 const screen=await readPhysicalScreen(browser);console.log('browser',browser.version(),'screen',screen);
 for(const viewport of [{width:390,height:844},{width:1440,height:900}])for(let repeat=0;repeat<20;repeat++){
  const context=await browser.newContext({viewport,screen});let frames;
  try {
   const page=await context.newPage();frames=await startFrameControl(page);
   await page.setContent(`<style>html,body{margin:0;height:10000px;background:#ccc}.glyph{position:absolute;left:16px;width:300px;height:96px;background:white;color:black;overflow:hidden}.glyph pre{font:13.6px/19.72px 'Liberation Mono',monospace;overflow:auto;margin:0;height:48px}.glyph .copyright{display:block;font:13.6px/19.72px Arial,sans-serif;opacity:.7;padding-top:8px}canvas{position:absolute;width:4px;height:4px}</style>${Array.from({length:5},(_,i)=>`<div class="glyph" style="top:${100+i*2000}px"><pre><code><span style="display:block">cp .config/docker_example.yml .config/default.yml</span><span style="display:block">sudo docker compose build</span></code></pre><span class="copyright">© 2025 syuilo and Misskey Project</span></div><canvas class="two" width="4" height="4" style="left:330px;top:${100+i*2000}px"></canvas><canvas class="gl" width="4" height="4" style="left:340px;top:${100+i*2000}px"></canvas>`).join('')}`);
   await page.evaluate(()=>{
    for(const canvas of document.querySelectorAll('canvas.two')){const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(7,8,9)';ctx.fillRect(0,0,4,4);}
    for(const canvas of document.querySelectorAll('canvas.gl')){const gl=canvas.getContext('webgl');if(!gl)throw Error('WebGL unavailable');gl.clearColor(12/255,34/255,56/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.finish();}
   });
   await frames.pause();let reference;
   for(let capture=0;capture<3;capture++){
    const snapshot=await takeSnapshot(page);const tiles=snapshot.tiles.map(t=>({...t,png:PNG.sync.read(t.bytes)}));
    const pixel=(x,y)=>{const tile=tiles.find(t=>y>=t.y&&y<t.y+t.png.height);const i=((y-tile.y)*tile.png.width+x)*4;return tile.png.data.subarray(i,i+4);};
    const cells=[];
    for(let band=0;band<5;band++){
     const bytes=Buffer.alloc(300*96*4);let offset=0;
     for(let y=100+band*2000;y<196+band*2000;y++)for(let x=16;x<316;x++){pixel(x,y).copy(bytes,offset);offset+=4;}
     cells.push(bytes);
     for(const [x,color]of[[330,[7,8,9,255]],[340,[12,34,56,255]]])for(let y=100+band*2000;y<104+band*2000;y++)for(let dx=0;dx<4;dx++)assert.deepEqual([...pixel(x+dx,y)],color,`Canvas missing at ${x+dx},${y}`);
    }
    if(!reference){reference=cells[0];let codeInk=0,footerInk=0;for(let y=0;y<96;y++)for(let x=0;x<300;x++){const i=(y*300+x)*4;if(reference[i]<200||reference[i+1]<200||reference[i+2]<200){if(y<48)codeInk++;else footerInk++;}}assert.ok(codeInk>100&&footerInk>100,'Visible reference text must contain both code and copyright glyphs');}
    for(const [band,bytes]of cells.entries())assert.ok(bytes.equals(reference),`Offscreen glyphs changed or disappeared: viewport${viewport.width} repeat${repeat} capture${capture} band${band}`);
   }
  }finally{await frames?.close();await context.close();}
 }
 console.log('All 120 full tiled captures retained all visible/offscreen glyphs, 2D and WebGL pixels');
}finally{await browser.close();}
