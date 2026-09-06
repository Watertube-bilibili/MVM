export const COMPATIBILITY_PROBE = {
  available: process.platform === 'win32' && process.arch === 'x64',
  name: 'MVM Compatibility Engine',
  version: 'MVM-CPU/2',
  detail: 'Windows x64：Mach-O 加载、函数调用、Darwin 文件读取与 NSAlert 对话框桥接。',
};
