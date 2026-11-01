import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import assert from "node:assert/strict";
import { takeSnapshot } from "../tests/vrt/snapshot.mjs";
const browser = await chromium.launch({channel:process.env.VRT_BROWSER_CHANNEL === "chromium" ? "chromium" : undefined,args:["--enable-gpu-benchmarking"]});
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 const colors = [[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255]];
 await page.setContent(`<style>body{margin:0}div{height:2000px}</style>${colors.map(c=>`<div style="background:rgb(${c.join(",")})"></div>`).join("")}`);
 const capture = await takeSnapshot(page);
 assert.equal(capture.width,390); assert.equal(capture.height,10000);
 let checked = 0;
 for (const tile of capture.tiles) {
  const png = PNG.sync.read(tile.bytes);
  for (let y=0;y<png.height;y++) {
   const expected=colors[Math.floor((tile.y+y)/2000)];
   for(let x=0;x<png.width;x++) {
    const i=(y*png.width+x)*4;
    assert.deepEqual([...png.data.subarray(i,i+4)],[...expected,255], `pixel ${x},${tile.y+y}`);
    checked++;
   }
  }
 }
 console.log(`Clip fixture: all ${checked} pixels checked, including beyond the viewport`);
} finally { await browser.close(); }
