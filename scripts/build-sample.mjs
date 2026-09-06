import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zig = process.argv[2] ?? process.env.MVM_ZIG ?? 'zig';
const version = spawnSync(zig, ['version'], {encoding:'utf8', windowsHide:true});
if (version.error || version.status !== 0 || version.stdout.trim() !== '0.15.2') {
  throw new Error('Use official Zig 0.15.2: npm run build:sample -- C:\\path\\to\\zig.exe');
}
mkdirSync(path.join(root,'resources/samples'), {recursive:true});
const args = ['cc','-target','x86_64-macos','-O0','-fno-stack-protector','-fno-builtin',
  '-Lsamples/MVMProbe/link','-lobjc','-lAppKit','samples/MVMProbe/main.c','-o','resources/samples/MVMProbe'];
const result = spawnSync(zig, args, {cwd:root,stdio:'inherit',windowsHide:true});
if (result.error || result.status !== 0) throw new Error('macOS sample compilation failed.');
for (const file of ['message.txt','Info.plist']) copyFileSync(path.join(root,'samples/MVMProbe',file),path.join(root,'resources/samples',file));
console.log('Built macOS x86_64 sample. Run npm test before packaging.');
