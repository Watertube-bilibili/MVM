import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { runCompatibilityExecutable, type CompatibilityOptions, type CompatibilityResult } from './index.js';
import type { AlertRequest } from './host.js';

/** CPU execution has its own V8 isolate. The parent alone owns Windows dialogs. */
export async function runCompatibilityWorker(filePath:string,options:CompatibilityOptions):Promise<CompatibilityResult> {
  // Vitest loads the TypeScript source directly; production always uses worker.js.
  if (__filename.endsWith('.ts')) return await runCompatibilityExecutable(filePath,options);
  const {showAlert,...workerOptions} = options;
  return await new Promise<CompatibilityResult>((resolve)=>{
    let settled = false;
    const fail = (message:string):CompatibilityResult=>({engine:'MVM-CPU/2',status:'blocked',code:'INPUT_INVALID',message,stdout:'',stderr:'',hostCalls:[],dialogsShown:0,translatedInstructionCount:0,executedInstructionCount:0});
    let worker:Worker;
    try { worker = new Worker(path.join(__dirname,'worker.js'),{workerData:{filePath,options:workerOptions,gui:Boolean(showAlert)},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}}); }
    catch(error) {resolve(fail(String(error)));return;}
    let timer:ReturnType<typeof setTimeout>;
    let remaining = 30000, armedAt = 0;
    const finish = (result:CompatibilityResult)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(result);};
    const arm = ()=>{armedAt=performance.now();timer=setTimeout(()=>finish(fail('Execution exceeded 30 seconds of active runtime.')),Math.max(1,remaining));};
    arm();
    worker.on('error',error=>finish(fail(error instanceof Error ? error.message : String(error))));
    worker.on('exit',code=>{if(!settled)finish(fail(`Engine worker exited before a result (${code}).`));});
    worker.on('message',(message:{kind:string;id:number;request?:AlertRequest;result?:CompatibilityResult})=>{
      if(settled)return;
      if(message.kind==='result' && message.result){finish(message.result);return;}
      if(message.kind==='alert' && showAlert){
        const r=message.request;
        if(!r || typeof r.message!=='string' || r.message.length>16384 || typeof r.detail!=='string' || r.detail.length>16384 || !Array.isArray(r.buttons) || r.buttons.length<1 || r.buttons.length>8 || r.buttons.some(b=>typeof b!=='string'||b.length>16384)) {finish(fail('Invalid GUI bridge request.'));return;}
        clearTimeout(timer);
        remaining -= performance.now()-armedAt;
        void showAlert(r).then(response=>{if(!settled){worker.postMessage({id:message.id,response});arm();}},error=>{if(!settled){worker.postMessage({id:message.id,error:String(error)});arm();}});
      }
    });
  });
}
