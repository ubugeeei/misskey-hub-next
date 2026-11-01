const controllers = new WeakMap();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function startFrameControl(page) {
 if (process.env.VRT_FRAME_MODE !== "manual") return;
 const session = await page.context().newCDPSession(page);
 let running = true, failure;
 const frame = noDisplayUpdates => session.send("HeadlessExperimental.beginFrame", {noDisplayUpdates});
 await frame(true);
 const pump = (async () => {while(running){await frame(true);await delay(16);}})().catch(error=>{failure=error;});
 const controller = {
  async pause(){running=false;await pump;if(failure)throw failure;},
  async drive(action,noDisplayUpdates){
   let done=false,value,error;
   const pending=Promise.resolve().then(action).then(result=>{value=result;done=true;},reason=>{error=reason;done=true;});
   const deadline=performance.now()+60000;
   while(!done&&performance.now()<deadline){await delay(16);if(!done)await frame(noDisplayUpdates);}
   if(!done)throw Error("Controlled frame operation exceeded 60 seconds");
   await pending;if(error)throw error;return value;
  },
  async close(){running=false;await pump;controllers.delete(page);await session.detach().catch(()=>{});}
 };
 controllers.set(page,controller);return controller;
}
export function withFrameProgress(page, action, noDisplayUpdates=false){
 const controller=controllers.get(page);
 return controller ? controller.drive(action,noDisplayUpdates) : action();
}
