import { parentPort, workerData } from 'node:worker_threads';
import { runCompatibilityExecutable, type CompatibilityOptions } from './index.js';
const port = parentPort;
if (!port) throw new Error('Compatibility worker requires a parent.');
let nextId = 0;
const replies = new Map<number,{resolve:(response:number)=>void;reject:(error:Error)=>void}>();
port.on('message',(message:{id:number;response?:number;error?:string})=>{
  const pending = replies.get(message.id); if (!pending) return;
  replies.delete(message.id);
  if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.response ?? 0);
});
const data = workerData as {filePath:string;options:CompatibilityOptions;gui:boolean};
void runCompatibilityExecutable(data.filePath,{
  ...data.options,
  ...(data.gui ? {showAlert: request => new Promise<number>((resolve,reject)=>{
    const id = ++nextId; replies.set(id,{resolve,reject}); port.postMessage({kind:'alert',id,request});
  })} : {}),
}).then(result=>{port.postMessage({kind:'result',result});port.close();});
