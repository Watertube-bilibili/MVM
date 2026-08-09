# MVM 0.1 测试指南

本指南用于验证 MVM 技术预览的真实能力，不用于生成或宣传兼容率。测试结论必须区分“静态分析完成”“后端可尝试”“命令已发送”和“应用功能已验证”。

## 环境要求

- Windows 10/11 x64；
- Node.js 24 或更高版本；
- npm 11 或更高版本；
- 从源码运行时需要正常可用的 PowerShell；
- 归档集成测试使用仓库内 `resources/runtime/7zip/7z.exe` 与 `7z.dll`；
- Darling/WSL 仅用于可选实验启动，不是自动化静态测试的前置条件。

只使用你有权测试的应用或公开可追溯 fixture。不要把真实商业应用、Apple 专有系统文件或个人数据提交到公开测试仓库。

## 安装依赖

```powershell
cd <path-to-MVM>
npm install
```

`npm install` 会下载当前锁定的 Electron 运行时。验证依赖版本时以 `package-lock.json` 为准，不要在基线测试中无意执行宽松升级。

## 自动化验证

### 单元与集成测试

```powershell
npm test
```

当前基线包含 4 个 Vitest 测试文件、29 项测试，覆盖：

- thin 与 universal/fat Mach-O 的架构、load command、最低系统版本、动态库、rpath、加密和异常边界；
- 文件魔数识别；
- XML 与 binary plist；
- `.app` 中 Info.plist 到主程序的关联，以及不安全 `CFBundleExecutable` 拒绝；
- 归档路径规范化、穿越、链接逃逸、Windows 名称冲突、成员/体积上限；
- 7-Zip `-slt` 技术列表的解析、失败关闭和安全预检；
- 本地结构样本的端到端分析；
- ZIP 中只物化 Info.plist 与主程序的服务集成路径；
- 直接 `.app` 的全 Bundle manifest 会区分资源内容和不同来源路径；
- 无效持久化记录隔离、主机 UNC 输入在文件系统访问前拒绝；
- 失败归档导入会删除本次 managed input copy；
- `wsl --list --verbose` 输出中只选择 `VERSION 2` 且排除 Docker 发行版。

Darling 的真实 GUI 兼容、Windows SmartScreen 和安装器交互不属于这组自动化测试，必须单独记录环境与人工证据。

### 类型检查与生产构建

```powershell
npm run typecheck
npm run build
```

`typecheck` 分别检查 Electron 主进程/预加载、React 渲染器和 Vite 配置。`build` 还会生成：

- `dist-electron\`：主进程和预加载 JavaScript；
- `dist\`：生产渲染器资源。

任一命令非零退出都应阻止发布。

### 开发模式

```powershell
npm run dev
```

预期出现一个标题为 MVM 的窗口。开发服务器只绑定 `127.0.0.1`；主进程拒绝非 localhost 的开发 URL。检查窗口可调整至最小 960×640，核心按钮仍应可见或通过滚动到达。

## 手工功能冒烟测试

每个发布候选至少完成以下流程，并保存版本、时间、Windows 版本、输入哈希、截图和导出的事件 JSON。

### 1. 空状态与结构样本

1. 在干净用户数据目录启动 MVM。
2. 确认应用库为空且随包 7-Zip 已探测；在用户点击“探测运行能力”前，WSL/Darling 不应自动运行命令。
3. 点击应用库标题旁的立方体按钮创建“本地结构样本”。
4. 确认样本创建在独立的 `fixtures\<uuid>\MVM Probe.app`，明确标注为结构样本，并识别 `x86_64` 和 `arm64`、AppKit 和 Foundation。
5. 确认发现中包含 `SOURCE_FIXTURE` 和 `FIXTURE_NOT_LAUNCHABLE`，启动按钮保持禁用。
6. 导出报告，检查 schema 为 `io.mvm.report.v1`，且没有把样本描述为真实兼容应用。

### 2. 直接 `.app` 文件夹

1. 使用拥有合法测试权、包含标准 `Contents/Info.plist` 与 `Contents/MacOS/<入口>` 的 `.app`。
2. 通过“选择 .app 文件夹”和拖放分别导入一次。
3. 核对 Bundle ID、版本、入口、架构、最低系统版本、Framework 和 64 位十六进制来源哈希。该哈希应代表 `mvm-bundle-manifest-v1` 全 Bundle，而不只是 plist/主程序。
4. 在两个其余结构相同的副本中分别修改 `Contents/Resources/payload.txt`，确认 manifest 哈希不同。
5. 导入期间并发修改 Bundle，确认 manifest-before/结构分析/manifest-after 不一致会安全失败。
6. 有健康 Darling 后，在导入完成与点击启动之间修改任一资源；确认启动前 manifest 不等于保存哈希时阻断并要求重新导入。
7. 在启动前复核期间修改 Bundle，确认 fresh analysis 后的 manifest-after 变化也阻断。
8. 移动或删除原 `.app` 后确认启动前复核失败；直接导入仍引用原目录，不是不可变副本。
9. 没有 Darling 时，确认结果为“需要运行后端”且不能启动。
10. 只有 ARM64 slice 时，即使 Darling 可发现，也应显示 Darling 需要 `x86_64` 的阻断。

上述复核仍不能证明没有 TOCTOU：最后一个 manifest 结束到 WSL/Darling 真正读取路径之间存在窄窗口。测试报告必须把它记录为残余风险，不能称为不可篡改执行。

### 3. ZIP/DMG 归档

1. 使用包含直接可见 `Sample.app/Contents/Info.plist` 和主程序的安全归档。
2. 导入后确认扩展名与魔数匹配；改扩展名的伪造文件应被拒绝。
3. 确认 UI 显示静态元数据，但包含 `ARCHIVE_STATIC_IMPORT_ONLY` 阻断项。
4. 确认归档记录不能交给 Darling，即使主程序含 `x86_64`。
5. 检查用户数据中的最小物化 Bundle 只用于分析，不把它当作完整安装。
6. 测试加密归档时，应在读取成员前拒绝。
7. 导入扩展名/魔数不匹配或结构损坏的归档，确认失败后 `imports` 中没有残留本次 UUID managed copy。

DMG 的可见目录层级取决于其分区/文件系统结构和 7-Zip 列表。未加密且格式受支持不代表一定能找到直接可见 `.app`。

### 4. PKG

1. 使用无敏感数据、可重新生成的 PKG fixture。
2. 确认 MVM 不弹出 Apple 安装流程、不请求管理员权限、不创建系统服务，也不执行任何安装脚本。
3. 若 `.app` 直接出现在容器列表中，可得到仅静态分析记录。
4. 若 `.app` 只在嵌套 Payload 中，当前版本应安全失败并建议直接导入已展开 `.app`；不要把它记录成解析器回归。
5. 在进程监视器中确认没有执行包内 `preinstall`、`postinstall` 或其他二进制。

### 5. 负向安全样本

仅用自建 fixture 验证下列输入会失败关闭：

- 作为主机导入来源的 UNC、设备、扩展设备、`GLOBALROOT` 或非本机盘符路径；
- 归档成员中的 `../outside`、绝对/UNC/驱动器路径；
- `file:stream`、`CON`/`NUL` 等 Windows 保留名、尾随点/空格；
- 大小写或 Unicode 归一化冲突；
- 越出归档根的符号链接/硬链接；
- 重复条目、不完整或重复字段的 7-Zip 技术列表；
- 超过 250,000 个条目或 32 GiB 声明展开体积；
- 超过 16 GiB 的容器、32 MiB 的 plist 或 512 MiB 的主程序；
- 截断/越界 Mach-O、非法 plist、缺失入口和加密 slice。

不要从互联网下载未知“恶意测试包”在日常工作机上直接测试。需要模糊测试时使用可销毁虚拟机，并为 7-Zip 和 Electron 进程设置额外的系统级限制。

### 6. 报告、事件与记录移除

1. 导出单个报告和全部事件，验证 JSON 可解析、schema 与时间戳存在。
2. 检查导出内容是否含本机绝对路径、WSL 发行版名等敏感信息。
3. 从应用库移除记录，确认原始 `.app` 或归档来源未被删除。
4. 记录当前已知行为：`imports\<id>` 中的归档副本不会随记录移除自动清理。

## 可选 Darling/WSL 冒烟测试

该测试风险高于静态导入。先阅读 [SECURITY.md](SECURITY.md)，使用专用测试账户/虚拟机和不含生产数据的 WSL 发行版。

1. 运行 `wsl.exe --list --verbose`，确认目标发行版的 `VERSION` 明确为 `2`；只有 WSL1 时 MVM 必须保持后端不可用。
2. 在 MVM 点击“探测运行能力”，确认它只以非登录 `sh -c` 执行 `command -v darling` / `darling --version`，记录选中的 WSL2 发行版和版本；此阶段不得进入 `darling shell`，状态应为“命令已发现；启动时验证用户态”。
3. 在该发行版中预先确认 `darling shell uname -s` 可在测试环境返回 `Darwin`，但把 MVM 的实际健康检查留到下一步“尝试启动”。
4. 导入一个合法、无静态阻断且含 `x86_64` 的直接 `.app`。
5. 点击“尝试启动”，确认 MVM 先运行 `darling shell uname -s`；只有返回 `Darwin` 后才紧邻执行 manifest-before、fresh analysis、manifest-after 和 spawn。健康失败时不得扫描后继续执行应用；成功提交后也只报告“命令已发送”，不直接写“启动成功”。
6. 在 WSL/Darling 中核对进程、标准日志、窗口和退出结果。
7. 分别记录：命令提交、进程创建、窗口出现、基本交互、退出码。前一项不能代替后一项。

当前 MVM 在用户点击“探测”时只确认发行版报告 `VERSION 2` 并发现 Darling 命令；点击“尝试启动”后才进入 Darling shell 验证最小用户态命令。两者都不验证 WSLg、X11、窗口转发或图形栈。MVM 0.1 **不创建隔离或一次性 Darling prefix**，测试直接使用用户自备环境；测试报告必须注明这些限制。复杂 GUI、Metal、驱动、XPC、特权 Helper、Apple 服务和 ARM64-only 应用不应记为首代预期通过项。

## 桌面壳与状态一致性测试

1. 启动第二个 MVM 进程，确认不会创建第二个服务实例，而是恢复并聚焦已有窗口。
2. 在开发模式确认只接受已配置的 localhost origin；在打包模式确认 IPC 只接受精确 `dist/index.html` 的 `file:` main frame。
3. 尝试 iframe/子 frame IPC、页面导航、HTTP 重定向、新窗口和 webview，确认全部被拒绝。
4. 请求摄像头、麦克风、地理位置、通知等 Chromium 权限，确认 permission check/request 都拒绝。
5. 检查生产 HTML 的 CSP 存在，脚本仅同源，object、frame、base 和 form-action 被禁用。
6. 快速连续触发会写状态的操作，关闭并重启后确认 `mvm-state.json` 仍是完整 JSON；持久化应经单一队列临时写入后 rename。
7. 手工放入 schema v1 但字段、枚举、长度、时间、哈希或路径无效的应用/事件记录，确认启动时按完整 schema 隔离无效项、记录警告，并把修复后的有效状态重新持久化；顶层 schema 无效时应重建为空状态。

## 打包与安装测试

### 生成构建

```powershell
npm run pack
npm run dist
```

- `pack` 在 `release\win-unpacked`（具体目录名以 electron-builder 输出为准）生成免安装目录，适合快速冒烟。
- `dist` 在 `release\` 生成 Windows x64 的 NSIS 安装程序和便携 `.exe`。

构建完成后确认：

- `resources\runtime\7zip\7z.exe`、`7z.dll` 和 `License.txt` 全部存在；
- 打包版只调用上述随包 7-Zip，不从 PATH 或 Program Files 回退；在复制的测试构建中分别替换/篡改 `7z.exe` 或 `7z.dll`，确认固定 SHA-256 校验失败且归档导入保持不可用；
- Electron/Chromium 许可证文件存在；
- MVM 能在没有系统 7-Zip、没有 WSL/Darling 的干净 Windows 测试机上启动并完成结构样本分析；
- 安装程序按用户安装、不要求提升权限、可选择目录，并正确创建所选快捷方式；
- 卸载程序移除程序文件和快捷方式，但测试记录表明用户数据是否保留；
- 便携版从含空格和非 ASCII 字符的路径启动正常。

### 未签名构建与 SmartScreen

MVM 0.1 发布物未代码签名。使用干净虚拟机测试 SmartScreen：

1. 记录文件哈希、来源和下载方式；
2. 验证 Windows 可能显示未知发布者/SmartScreen 提示；
3. 只对自己构建或已通过可信渠道核对哈希的文件继续；
4. 不在用户文档中暗示 SmartScreen 警告是“误报”或可以无条件忽略。

## 数据清理测试

Electron `userData` 在 Windows 上通常为 `%APPDATA%\MVM`。分别测试安装版和便携版：

1. 导入一个直接 `.app`、一个归档并创建结构样本；
2. 关闭 MVM，检查 `mvm-state.json`、`imports`、`fixtures\<uuid>`；
3. 移除 UI 记录，确认源文件保留，归档内部副本当前也保留；
4. 卸载安装版或删除便携版，确认用户数据通常仍存在；
5. 备份所需报告后，手动删除经确认的 MVM 用户数据目录；
6. 再次启动时应得到空应用库。

清理命令具有破坏性，不应写入自动化脚本指向宽泛目录；测试人员必须解析并人工确认精确的 MVM 数据路径。

## 发布判定

以下条件全部满足才可称为 MVM 0.1 技术预览发布候选：

- 自动化测试、类型检查与生产构建均通过；
- 当前 29 项自动化基线全部通过，且没有因跳过安全相关测试而得到绿色结果；
- 结构样本、直接 `.app`、ZIP/DMG 静态路径和 PKG 安全失败行为经过人工复核；
- 直接 `.app` 的完整 manifest、启动前重新分析、输入路径拒绝和 WSL2/Darling 健康检查经过复核；
- 无后端时没有任何“可运行/已启动”误报；
- 归档始终带静态分析阻断，PKG 脚本从未执行；
- 安装版、便携版、卸载和用户数据残留行为已有记录；
- 最终分发包含 Electron/Chromium 与 7-Zip 许可证；
- README、安全说明和第三方声明与实际构建版本一致。
