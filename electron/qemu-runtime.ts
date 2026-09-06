import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename, readdir, lstat, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as portServer } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { DARLING_ASSET_URL, DARLING_ASSET_SHA256, DARLING_DEB_FILES } from './darling-installer.js';
import { NativeFileBridge } from './native-runtime/file-bridge.js';

const exec = promisify(execFile);
const IMAGE_ROOT = 'https://cloud-images.ubuntu.com/noble/current/';
const IMAGE_NAME = 'noble-server-cloudimg-amd64.img';
export interface QemuState { phase: 'offline'|'preparing'|'booting'|'ready'|'error'; message: string; running: boolean }
export interface QemuRunResult { status: 'submitted'|'blocked'; message: string }
export const shQuote = (text:string):string => "'"+text.replaceAll("'","'\\''")+"'";

/** A stock Ubuntu guest is provisioned by cloud-init, not by a Windows Linux layer. */
export function cloudConfig(publicKey:string):string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(publicKey.trim())) throw new Error('Invalid SSH public key.');
  const script = `#!/bin/bash
set -euo pipefail
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl unzip openssh-server xorg openbox lightdm xterm
install -d -m 0755 /opt/mvm-darling
cd /opt/mvm-darling
curl --fail --location --retry 3 ${shQuote(DARLING_ASSET_URL)} -o darling.zip
echo ${shQuote(DARLING_ASSET_SHA256+'  darling.zip')} | sha256sum -c -
unzip -o darling.zip
apt-get install -y ${DARLING_DEB_FILES.map(f=>shQuote('./debs_20260609/'+f)).join(' ')}
install -d /etc/lightdm/lightdm.conf.d
printf '[Seat:*]\\nautologin-user=mvm\\nuser-session=openbox\\n' > /etc/lightdm/lightdm.conf.d/50-mvm.conf
printf 'exec openbox-session\\n' > /home/mvm/.xsession
chown mvm:mvm /home/mvm/.xsession
systemctl enable --now lightdm
touch /var/lib/mvm-darling-ready
`;
  return '#cloud-config\n'+JSON.stringify({hostname:'mvm-qemu',ssh_pwauth:false,disable_root:true,
    users:[{name:'mvm',shell:'/bin/bash',lock_passwd:true,groups:['video','audio'],ssh_authorized_keys:[publicKey.trim()]}],
    write_files:[{path:'/opt/mvm-bootstrap.sh',permissions:'0700',content:script}],
    runcmd:[['bash','-c','/opt/mvm-bootstrap.sh > /var/log/mvm-bootstrap.log 2>&1']]
  },null,2)+'\n';
}

export function qemuArguments(disk:string,sshPort:number,seedPort:number,token:string,serialLog:string):string[] {
  if (![sshPort,seedPort].every(n=>Number.isInteger(n)&&n>1023&&n<65536) || !/^[a-f0-9-]+$/.test(token)) throw new Error('Invalid local QEMU endpoint.');
  return ['-name','MVM - QEMU + Darling','-machine','q35','-accel','tcg,thread=multi','-cpu','max','-smp','2','-m','4096',
    '-drive',`file=${disk.replaceAll(',',',,')},format=qcow2,if=virtio`,
    '-nic',`user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
    '-smbios',`type=1,serial=ds=nocloud-net;s=http://10.0.2.2:${seedPort}/${token}/`,
    '-vga','std','-monitor','stdio','-serial',`file:${serialLog}`];
}

async function freePort():Promise<number> {
  const server=portServer();
  return await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
    const address=server.address(); const port=typeof address==='object'&&address?address.port:0;
    server.close(error=>error?reject(error):resolve(port));
  });});
}
async function sha256(file:string):Promise<string> {
  const hash=createHash('sha256'); for await(const chunk of createReadStream(file))hash.update(chunk); return hash.digest('hex');
}

export class QemuRuntime {
  private state:QemuState={phase:'offline',message:'需要标准 QEMU；首次准备会下载 Ubuntu 镜像并在虚拟机内安装 Darling。',running:false};
  private child:ChildProcess|undefined;
  private seed:Server|undefined;
  private poll:ReturnType<typeof setInterval>|undefined;
  private sshPort=0;
  private checking=false;
  private transferring=false;
  private busy=false;
  private abort:AbortController|undefined;
  private readonly ssh:string;
  private readonly scp:string;
  public constructor(private readonly root:string,private readonly sevenZip:string){
    const bin=path.join(process.env.SystemRoot??'C:\\Windows','System32','OpenSSH');
    this.ssh=path.join(bin,'ssh.exe');this.scp=path.join(bin,'scp.exe');
  }
  public status():QemuState{return {...this.state};}
  public isRunning():boolean{return this.state.running;}
  public async configuredExecutable():Promise<string|undefined>{
    try{return JSON.parse(await readFile(path.join(this.root,'config.json'),'utf8')).executable as string;}catch{return undefined;}
  }
  private async command(executable:string,args:string[],timeout=30000):Promise<string>{
    const result=await exec(executable,args,{cwd:this.root,windowsHide:true,timeout,maxBuffer:2*1024*1024});return result.stdout;
  }
  private sshArgs():string[]{return ['-p',String(this.sshPort),'-i',path.join(this.root,'identity'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=accept-new','-o','HostKeyAlias=mvm-managed-qemu','-o',`UserKnownHostsFile=${path.join(this.root,'known_hosts')}`];}
  private async guest(command:string,timeout=15000):Promise<string>{
    if(!this.child||this.child.exitCode!==null)throw new Error('QEMU is not running.');
    return await this.command(this.ssh,[...this.sshArgs(),'mvm@127.0.0.1',command],timeout);
  }
  public async prepare(executable:string):Promise<QemuState>{
    if(this.busy||this.child)return this.status();
    this.busy=true;this.abort=new AbortController();this.state={phase:'preparing',message:'核对 QEMU 和 Windows OpenSSH…',running:false};
    // Return promptly; the UI polls progress while downloads and guest boot continue.
    void this.boot(executable).catch(error=>{this.state={...this.state,phase:'error',message:String(error)};if(!this.child)this.cleanup();}).finally(()=>{this.busy=false;});
    return this.status();
  }
  private async boot(executable:string):Promise<void>{
    await mkdir(this.root,{recursive:true});
    if(!path.isAbsolute(executable)||path.basename(executable).toLowerCase()!=='qemu-system-x86_64.exe'||!(await stat(executable)).isFile())throw new Error('请选择标准 qemu-system-x86_64.exe。');
    const version=await this.command(executable,['--version']);
    if(!version.includes('QEMU'))throw new Error('QEMU version check failed.');
    await stat(this.ssh);await stat(this.scp);
    await writeFile(path.join(this.root,'config.json'),JSON.stringify({executable}));
    const image=path.join(this.root,IMAGE_NAME),disk=path.join(this.root,'mvm.qcow2');
    let hasDisk=false;try{hasDisk=(await stat(disk)).isFile();}catch{}
    if(!hasDisk){
      this.state.message='下载 Ubuntu 24.04 镜像（约 625 MB），并校验 SHA-256…';
      const sums=await fetch(IMAGE_ROOT+'SHA256SUMS',{signal:AbortSignal.any([this.abort!.signal,AbortSignal.timeout(30000)])});
      if(!sums.ok)throw new Error('Cannot obtain official Ubuntu checksums.');
      const expected=(await sums.text()).split('\n').find(line=>line.trim().endsWith(' '+IMAGE_NAME)||line.trim().endsWith('*'+IMAGE_NAME))?.slice(0,64);
      if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw new Error('Ubuntu checksum entry missing.');
      let cached=false;try{cached=(await sha256(image))===expected;}catch{}
      if(!cached){
        const response=await fetch(IMAGE_ROOT+IMAGE_NAME,{signal:AbortSignal.any([this.abort!.signal,AbortSignal.timeout(30*60*1000)])});
        if(!response.ok||!response.body)throw new Error('Ubuntu image download failed.');
        let bytes=0;const stream=Readable.fromWeb(response.body as never);
        stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024**3)stream.destroy(new Error('Image exceeds 2 GiB limit.'));this.state.message=`下载 Ubuntu 镜像：${Math.floor(bytes/1024**2)} MB`;});
        await pipeline(stream,createWriteStream(image+'.part'));
        if(await sha256(image+'.part')!==expected)throw new Error('Ubuntu SHA-256 mismatch.');
        await rename(image+'.part',image);
      }
      await this.command(path.join(path.dirname(executable),'qemu-img.exe'),['create','-f','qcow2','-F','qcow2','-b',image,disk,'32G']);
    }
    const identity=path.join(this.root,'identity');
    try{await stat(identity);}catch{await this.command(path.join(path.dirname(this.ssh),'ssh-keygen.exe'),['-t','ed25519','-N','','-f',identity]);}
    this.abort!.signal.throwIfAborted();
    const userData=cloudConfig(await readFile(identity+'.pub','utf8'));
    const token=randomUUID();this.sshPort=await freePort();
    this.seed=createServer((req,res)=>{
      const endpoint=req.url;
      const data=endpoint===`/${token}/user-data`?userData:endpoint===`/${token}/meta-data`?'instance-id: mvm-qemu-v1\nlocal-hostname: mvm-qemu\n':endpoint===`/${token}/vendor-data`?'':undefined;
      if(data===undefined){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/plain');res.end(data);
    });
    await new Promise<void>((resolve,reject)=>{this.seed!.once('error',reject);this.seed!.listen(0,'127.0.0.1',()=>resolve());});
    const address=this.seed.address();if(!address||typeof address==='string')throw new Error('Seed server failed.');
    this.state={phase:'booting',message:'Ubuntu 正在启动并安装 Darling；首次启动可能需要 20–60 分钟。',running:true};
    const child=spawn(executable,qemuArguments(disk,this.sshPort,address.port,token,path.join(this.root,'serial.log')),{cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;let errors='';
    child.stdout?.on('data',()=>{});child.stderr?.on('data',(chunk:Buffer)=>{errors=(errors+chunk.toString()).slice(-4000);});
    child.once('error',error=>{this.state={phase:'error',message:String(error),running:false};this.cleanup();});
    child.once('exit',code=>{this.state={phase:code===0?'offline':'error',message:code===0?'虚拟机已关闭。':`QEMU 退出 ${code}: ${errors}`,running:false};this.cleanup();});
    const started=Date.now();
    this.poll=setInterval(()=>{if(this.checking||this.state.phase!=='booting')return;this.checking=true;
      void this.guest('test -f /var/lib/mvm-darling-ready && DISPLAY=:0 XAUTHORITY=/home/mvm/.Xauthority darling shell uname -s',60000).then(output=>{
        if(output.trim().endsWith('Darwin'))this.state={phase:'ready',message:'QEMU + Darling 用户态已验证；GUI 兼容性仍取决于 Darling。',running:true};
      }).catch(()=>{if(Date.now()-started>60*60*1000)this.state={phase:'error',message:'首次配置超过 60 分钟。请在 QEMU 中检查 /var/log/mvm-bootstrap.log。',running:true};}).finally(()=>{this.checking=false;});
    },10000);
  }
  private cleanup():void{if(this.poll)clearInterval(this.poll);this.seed?.close();this.seed=undefined;this.child=undefined;}
  public powerDown():QemuState{if(!this.child){this.abort?.abort();this.state={phase:'offline',message:'已取消准备。',running:false};}else{this.child.stdin?.write('system_powerdown\n');this.state.message='已请求虚拟机正常关机，请等待关机完成。';}return this.status();}
  public async run(bundle:string,executableName:string):Promise<QemuRunResult>{
    if(this.state.phase!=='ready')return {status:'blocked',message:'QEMU + Darling 尚未就绪，请先准备虚拟机。'};
    if(this.transferring)return {status:'blocked',message:'正在传送另一个应用，请稍后重试。'};
    this.transferring=true;
    const id=randomUUID(),archive=path.join(this.root,id+'.zip'),stage=path.join(this.root,'transfers',id);
    try{
      const snapshot=path.join(stage,'MVMImported.app');
      const bridge=new NativeFileBridge({rootPath:bundle,maxFileBytes:64*1024**2,maxTotalBytes:512*1024**2});
      let entries=0;
      const copy=async(relative:string):Promise<void>=>{
        if(++entries>4096)throw new Error('Bundle has too many entries.');
        const source=path.join(bundle,relative),info=await lstat(source);
        if(info.isSymbolicLink())throw new Error('QEMU transfer does not follow bundle links.');
        if(info.isDirectory()){
          await mkdir(path.join(snapshot,relative),{recursive:true});
          for(const name of await readdir(source))await copy(path.join(relative,name));
        }else if(info.isFile())await writeFile(path.join(snapshot,relative),await bridge.readFile(relative),{flag:'wx'});
        else throw new Error('Unsupported bundle member.');
      };
      await copy('');
      await exec(this.sevenZip,['a','-tzip',archive,'--','MVMImported.app'],{cwd:stage,windowsHide:true,timeout:120000,maxBuffer:2*1024**2});
      return await this.transfer(archive,snapshot,executableName,id);
    }catch(error){return {status:'blocked',message:String(error)};}
    finally{
      this.transferring=false;
      if(path.dirname(path.resolve(stage))===path.resolve(this.root,'transfers')&&/^[a-f0-9-]{36}$/.test(path.basename(stage)))await rm(stage,{recursive:true,force:true}).catch(()=>undefined);
      if(path.dirname(path.resolve(archive))===path.resolve(this.root))await rm(archive,{force:true}).catch(()=>undefined);
    }
  }
  private async transfer(archive:string,bundle:string,executableName:string,id:string):Promise<QemuRunResult>{
    const folder='/home/mvm/inbox/'+id;
    await this.guest('mkdir -p '+shQuote(folder));
    const args=this.sshArgs();args[0]='-P';
    await this.command(this.scp,[...args,archive,`mvm@127.0.0.1:${folder}/app.zip`],120000);
    const guestExecutable='/Volumes/SystemRoot'+folder+'/'+path.basename(bundle)+'/Contents/MacOS/'+executableName;
    await this.guest(`unzip -q ${shQuote(folder+'/app.zip')} -d ${shQuote(folder)} && chmod +x ${shQuote(folder+'/'+path.basename(bundle)+'/Contents/MacOS/'+executableName)} && (nohup env DISPLAY=:0 XAUTHORITY=/home/mvm/.Xauthority darling shell ${shQuote(guestExecutable)} > ${shQuote(folder+'/run.log')} 2>&1 < /dev/null &)`);
    return {status:'submitted',message:`应用已交给 QEMU 内的 Darling；请在 QEMU 窗口查看。未确认应用成功运行。日志：${folder}/run.log`};
  }
}
