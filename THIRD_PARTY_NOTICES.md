# MVM 第三方软件声明

本文件概述 MVM 0.1.0 运行时中直接使用或随应用分发的主要第三方组件。许可证名称来自当前锁定依赖的包元数据及随附许可证文件；它不是法律意见，也不取代各组件的完整许可证正文。

版本基线以 `package.json` 与 `package-lock.json` 为准。开发环境中的许可证路径以仓库根目录为相对起点；公开分发前还应对完整锁文件执行一次传递依赖许可证/SBOM 审计。

## Electron、Chromium 与 Node.js

### Electron 43.3.0

- 用途：Windows 桌面壳、主进程、预加载桥与 Chromium 渲染器。
- 许可证：MIT License。
- 上游版权：Electron contributors。
- 本地许可证：`node_modules/electron/LICENSE`。

Electron 的二进制发行版同时包含 Chromium、Node.js、V8、FFmpeg 等第三方组件。Electron 的 MIT 许可证不替代这些组件各自的许可证。

### Chromium（Electron 43.3.0 随附版本）

- 用途：页面渲染、沙箱、网络与多进程基础设施。
- 许可证：Chromium 主体采用 BSD 3-Clause 风格许可证；其源代码树还包含使用多种兼容开源许可证的第三方组件。
- 完整逐组件声明：开发环境中的 `node_modules/electron/dist/LICENSES.chromium.html`。Electron/打包工具通常会把该文件保留在应用分发目录，实际发布时应确认它与 MVM 可执行文件一起提供。

### Node.js（Electron 43.3.0 内嵌版本）

- 用途：Electron 主进程运行时及文件、加密、子进程等核心模块。
- 许可证：Node.js 主体采用 MIT License；Node.js 随附第三方代码适用各自的许可证。
- 相关完整声明由 Electron 二进制分发包的许可证文件覆盖；应与 `LICENSES.chromium.html` 一并保留，不应只保留 Electron 的 MIT 文本。

## React 与 Fluent UI

### React 19.2.8 与 React DOM 19.2.8

- 用途：MVM 图形界面的组件与渲染模型。
- 许可证：MIT License。
- 上游版权：Meta Platforms, Inc. 及其关联方。
- 本地许可证：`node_modules/react/LICENSE`、`node_modules/react-dom/LICENSE`。

### @fluentui/react-components 9.74.5

- 用途：Windows/Fluent 风格交互组件与主题。
- 许可证：MIT License。
- 上游版权：Microsoft Corporation。
- 本地许可证：`node_modules/@fluentui/react-components/LICENSE`。

### @fluentui/react-icons 2.0.335

- 用途：Fluent System Icons 图标组件。
- 许可证：发布包元数据声明为 MIT License。
- 上游版权：Microsoft Corporation。
- 本地发布包没有单独附带 `LICENSE` 文件；许可证声明可在 `node_modules/@fluentui/react-icons/package.json` 查阅，完整 MIT 文本由上游 Fluent System Icons 仓库提供。公开再分发前应确保生成的综合第三方声明包含该条目。

Fluent UI 组件会引入额外的 `@fluentui/*`、`@griffel/*` 等运行时包；其精确版本和许可证应以 `package-lock.json` 及发布时生成的完整传递依赖清单为准。

## plist 5.0.0

- 用途：解析 XML Property List；binary plist 由该包提供的适配能力处理。
- 许可证：MIT License。
- 上游版权：Copyright © 2010–2017 Nathan Rajlich；其他贡献者信息见包元数据。
- 本地许可证：`node_modules/plist/LICENSE`。

`plist` 的传递依赖也应包含在发布时生成的完整传递依赖清单中。

## 7-Zip 24.09

MVM 随包提供完整的 Windows 版 7-Zip 24.09：

- `resources/runtime/7zip/7z.exe`
- `resources/runtime/7zip/7z.dll`
- **完整随附许可：`resources/runtime/7zip/License.txt`**

安装后的对应位置位于 MVM 的资源目录下，例如 `resources/runtime/7zip/License.txt`；应以实际安装根目录为起点查找。该 `License.txt` 必须与二进制一起分发，不得删除。

根据随附文件：

- 7-Zip Copyright © 1999–2024 Igor Pavlov；
- `7z.exe` 等“其他文件”采用 GNU Lesser General Public License（LGPL）2.1 或更新版本；
- `7z.dll` 的大部分代码采用 LGPL 2.1 或更新版本；
- `7z.dll` 的部分 RAR 解压代码同时受 unRAR license restriction 限制，不得用于重新创建专有 RAR 压缩算法；
- LZFSE 与 ZSTD 解压相关代码包含 BSD 3-Clause 条款；
- XXH64 相关代码包含 BSD 2-Clause 条款。

本摘要不复制长篇许可证正文。重新分发二进制时必须保留 `resources/runtime/7zip/License.txt` 中的完整 LGPL、BSD 和 unRAR 条款与版权声明。MVM 不修改 7-Zip 二进制，也不把 7-Zip 描述为 MVM 自有代码。

## 其他构建期工具

TypeScript、Vite、Vitest、electron-builder、`@vitejs/plugin-react`、`concurrently`、`cross-env`、`wait-on` 及类型定义包用于开发、测试或打包，通常不作为独立程序随 MVM 运行时分发；如果最终构建实际包含其中任何代码，其许可证也必须纳入发布清单。精确版本见 `package.json` 与 `package-lock.json`。

## 分发检查清单

每次发布前至少确认：

1. 锁定版本与本文件一致；
2. Electron 的许可证和 `LICENSES.chromium.html` 存在于最终分发目录；
3. `resources/runtime/7zip/License.txt` 与 `7z.exe`、`7z.dll` 一同打包；
4. 通过锁文件生成并审阅完整的传递依赖许可证/SBOM；
5. 没有把第三方名称、图标或许可证误写为对 MVM 的认可或认证。
