# MVM

**MVM 0.1 — a Windows workbench for inspecting macOS application bundles and experimenting with a user-provided Darling/WSL2 runtime.**

[简体中文](#简体中文) · [English](#english) · [Latest release](https://github.com/Watertube-bilibili/MVM/releases/latest) · [Report an issue](https://github.com/Watertube-bilibili/MVM/issues/new)

> [!IMPORTANT]
> MVM 0.1 is a technical preview, not a Wine-level macOS compatibility layer. Archive imports are for static analysis only. Only a directly imported `.app` that contains `x86_64` code, has no blocking finding, and is paired with a user-installed Darling environment can be submitted for an experimental launch. “Command submitted” does not mean “application started successfully.” MVM and Darling are not security sandboxes.

---

<a id="简体中文"></a>

## 简体中文

### MVM 是什么

MVM 是一款运行在 Windows 10/11 x64 上的 macOS 应用包检查台。它提供 Windows 桌面图形界面，可导入 `.app` 文件夹以及 `.dmg`、`.pkg`、`.zip` 容器，读取 `Info.plist`、Mach-O 架构、Framework 和动态库依赖，并把发现结果与事件保存在本地应用库中。

这一代的重点是把“导入 → 安全预检 → 静态分析 → 报告 → 可选实验启动”做成可以实际测试的闭环。它不会附带 macOS、Apple SDK、系统 Framework、Rosetta 或 Apple 专有运行时，也不会绕过 DRM、签名、授权或 Apple 服务认证。静态分析通过只说明文件结构符合当前检查规则，不代表应用一定能够运行。

### 下载与安装

从 [最新 Release 页面](https://github.com/Watertube-bilibili/MVM/releases/latest) 下载，源码仓库不存放发行二进制。

| 文件 | 用途 |
|---|---|
| [MVM-Setup-0.1.0.exe](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/MVM-Setup-0.1.0.exe) | 推荐。按用户安装的 NSIS 安装程序，可选择目录，并可创建桌面和开始菜单快捷方式；不要求管理员权限。 |
| [MVM-Portable-0.1.0.exe](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/MVM-Portable-0.1.0.exe) | 便携版。无需安装，放在普通可写目录后直接运行；应用数据仍写入 Windows 用户数据目录。 |
| [SHA256SUMS.txt](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/SHA256SUMS.txt) | v0.1.0 两个可执行文件的 SHA-256 校验值。 |

当前 v0.1.0 构建尚未进行商业代码签名，Windows SmartScreen 可能显示“Windows 已保护你的电脑”或“未知发布者”。请先确认文件来自本仓库 Release，并在 PowerShell 中校验哈希：

```powershell
Get-FileHash '.\MVM-Setup-0.1.0.exe' -Algorithm SHA256
Get-FileHash '.\MVM-Portable-0.1.0.exe' -Algorithm SHA256
Get-Content '.\SHA256SUMS.txt'
```

预期值：

```text
AABE01623DB9A1AFAD8CED2B42757F809A5B7C46C86F0EA8FAE949C83C4C44EE  MVM-Portable-0.1.0.exe
36E5910179487C50B5F76F3F0402D94B9AEFD733C33125638E5D6725E66E3140  MVM-Setup-0.1.0.exe
```

只有文件名、来源和哈希都匹配时，才应在 SmartScreen 中选择“更多信息 → 仍要运行”。如果哈希不一致，请删除文件并重新从 Release 下载，不要绕过提示。

### 五分钟快速上手

#### 1. 先运行内置结构样本

首次启动后，点击应用库标题旁的立方体按钮“创建本地结构样本”，或在空状态中选择“加载本地结构样本”。MVM 会在本机生成一个明确标注、不可启动的 Universal 2 测试 Bundle，并用真实的 plist 与 Mach-O 分析器处理它。这样无需准备第三方 Mac 应用，也能验证界面、应用库、四阶段检查和报告导出。

#### 2. 导入自己的样本

- `.app`：点击“导入”并选择以 `.app` 结尾的本地文件夹，也可以把它拖入窗口。
- `.dmg`、`.pkg`、`.zip`：点击“选择安装包”或拖入文件。
- 只支持本机盘符路径；UNC、网络共享、设备路径和扩展设备路径会在读取前被拒绝。
- 只分析你有权使用与测试的应用。MVM 能读取某个包，不代表其许可允许在非 Apple 硬件或替代运行时中执行。

归档导入会先复制原容器到 MVM 管理的数据目录，然后进行格式识别、路径与展开体积预检，只物化第一个直接可见 `.app` 中用于分析的 `Info.plist` 与主程序。它不会安装应用，也不会重建整个 Bundle。

#### 3. 阅读四阶段检查结果

中央检查跑道按顺序展示：

1. **封装**：识别容器、Bundle 元数据、入口程序和最低系统版本。
2. **架构**：解析 thin 或 universal/fat Mach-O slice，包括 `x86_64`、`arm64`、`arm64e`。
3. **框架**：列出直接加载的 Framework、dylib、rpath、加密标记和代码签名结构声明。
4. **后端**：区分“仅完成静态分析”“需要运行后端”“具备实验启动条件”等状态。

右侧“发现”面板会给出 blocker、警告、证据与建议动作。CPU 架构匹配不等于 Cocoa、Metal、XPC、驱动或 Apple 服务兼容。

#### 4. 导出报告

选择应用后点击“导出报告”，可以保存该应用的兼容性 JSON；底部事件区可以导出全部事件 JSON。报告适合复现问题，但可能包含本机绝对路径、Bundle ID、哈希和 WSL 发行版名称，公开前请检查并脱敏。

### 可选：WSL2 / Darling 实验启动

Darling 和 WSL2 不随 MVM 安装。请先按照 [Microsoft WSL 文档](https://learn.microsoft.com/windows/wsl/install)准备一个 WSL2 Linux 发行版，再按照 [Darling 上游项目](https://github.com/darlinghq/darling)的说明自行构建或安装 Darling。MVM 不会自动安装、更新或修改它们。

1. 在 PowerShell 中确认目标发行版为 WSL2：

   ```powershell
   wsl --list --verbose
   ```

2. 在该 Linux 发行版中确认 Darling 命令存在：

   ```sh
   command -v darling
   darling --version
   ```

3. 回到 MVM，点击右侧的“探测运行能力”。探测只发现 WSL2 发行版与 Darling 命令，不会进入 Darling shell，也不代表后端已经健康。
4. 直接导入一个包含 `x86_64` slice 的 `.app`。只有它没有静态 blocker 时，“尝试启动”才可能启用。DMG、PKG、ZIP 导入记录永远只用于静态分析。
5. 点击“尝试启动”后，MVM 才会先执行 Darling 用户态健康检查，重新核对完整 Bundle 指纹和最新静态结果，再把原始 `.app` 路径交给后端。
6. “命令已发送”只代表启动请求已经提交。请结合应用窗口、退出事件和 Darling 日志判断是否真正运行成功。

当前实验后端主要面向 `x86_64` 应用。仅 ARM64 应用、复杂 Cocoa GUI、Metal、驱动、特权 Helper、Apple 服务以及依赖特殊图形栈的程序通常会被阻断或无法工作。MVM 不是安全沙箱，Darling 也不是隔离边界；运行第三方应用等同于执行不受信任代码，建议使用测试账户、虚拟机或不含敏感挂载的专用 WSL 发行版。

### 输入能力矩阵

| 输入 | v0.1.0 的处理方式 | 可尝试启动 |
|---|---|---|
| 直接 `.app` 文件夹 | 从原路径读取完整 Bundle，生成确定性 manifest SHA-256，并分析 `Info.plist` 与主 Mach-O；启动前再次执行指纹与结构复核。 | **有条件**：必须包含 `x86_64`、没有 blocker，并探测到用户自备的 WSL2/Darling。 |
| `.dmg` | 使用随包且固定哈希的 7-Zip 做只读列举与安全预检，仅提取静态分析所需的最小文件。 | **否**，归档导入仅静态分析。 |
| `.pkg` | 只做容器列举、安全预检和直接可见 Bundle 的最小静态分析；不递归安装 Payload。 | **否**，归档导入仅静态分析。 |
| `.zip` | 做完整成员路径预检，并仅提取静态分析所需的最小文件。 | **否**，归档导入仅静态分析。 |
| 本地结构样本 | 在独立 UUID 目录生成确定性测试 Bundle，用来验证真实 plist/Mach-O 分析链路。 | **否**，它不包含真实应用逻辑。 |

> [!CAUTION]
> MVM **绝不执行 PKG 的 `preinstall`、`postinstall` 或其他安装脚本**，也不会绕过受保护 Mach-O、DRM、收据、签名或授权检查。

### 本地数据、隐私与安全

- MVM 自身没有账户、遥测、云同步、自动上传或自动下载功能；导入、分析和报告生成都在本机完成。
- 应用记录、来源绝对路径、分析结果与最多 200 条事件摘要通常保存在 `%APPDATA%\MVM\mvm-state.json`。
- 归档的受管副本位于 `%APPDATA%\MVM\imports\<id>\`；结构样本位于 `%APPDATA%\MVM\fixtures\<uuid>\`。实际位置以当前 Windows/Electron 环境为准。
- 从应用库移除记录不会删除原始 `.app`、DMG、PKG 或 ZIP；成功归档导入留下的受管副本也不会随记录自动清理。
- 可选后端中启动的第三方应用可能自行访问网络或已挂载文件。这不属于 MVM 的隐私保证。
- 直接 `.app` 保持在用户控制的可变原路径。MVM 会在导入与启动前后进行完整指纹复核，但最终检查与后端打开文件之间仍存在很窄的 TOCTOU 窗口。
- 随包 7-Zip 会先校验固定 SHA-256，但它仍是以当前用户身份解析复杂第三方容器的本机程序。只处理可信或隔离环境中的样本。

更多威胁模型与残余风险见[安全说明](docs/SECURITY.md)。卸载安装版或删除便携版通常不会移除 `%APPDATA%\MVM`；彻底清理前请退出 MVM、确认路径无误，并备份需要保留的报告。

### 从源码构建与测试

要求 Windows 10/11 x64、Node.js 24 或更高版本、npm 11 或更高版本。

```powershell
git clone https://github.com/Watertube-bilibili/MVM.git
Set-Location MVM
npm ci
npm run dev
```

常用验证与发行命令：

```powershell
npm test
npm run typecheck
npm run build
npm run pack
npm run dist
```

- `npm run pack`：生成未安装目录构建。
- `npm run dist`：在 `release\` 下生成 Windows x64 NSIS 安装版和便携版。
- 发行 EXE 应作为 GitHub Release 资产上传，不应提交进 Git 历史。

### 架构与文档

桌面壳使用 Electron 43、TypeScript 7、React 19、Fluent UI 9 和 Vite 8。核心分析器负责严格边界下的格式识别、plist、Mach-O、路径安全与 7-Zip 只读预检；Electron 主进程负责持久化、IPC 和可选 WSL/Darling 编排。

- [架构设计](docs/ARCHITECTURE.md)
- [兼容性模型](docs/COMPATIBILITY.md)
- [测试指南](docs/TESTING.md)
- [安全与隐私](docs/SECURITY.md)
- [第三方软件声明](THIRD_PARTY_NOTICES.md)
- [界面设计系统](DESIGN.md)

### 反馈问题

请在 [GitHub Issues](https://github.com/Watertube-bilibili/MVM/issues/new) 提交问题，并尽量包含：

- Windows 版本、MVM 版本和安装方式；
- 可复现步骤、预期行为与实际行为；
- 输入类型及 Mach-O 架构；
- 相关 MVM 报告/事件；若使用实验后端，再附 `wsl --list --verbose` 与 `darling --version` 输出；
- 必要的截图或日志。

请勿上传你无权分发的应用、安装包、专有二进制、密钥或个人数据。JSON 和日志可能包含本机路径，提交前请脱敏。

---

<a id="english"></a>

## English

### What MVM is

MVM is a macOS application-package inspection workbench for Windows 10/11 x64. Its Windows desktop UI can import `.app` directories and `.dmg`, `.pkg`, or `.zip` containers, inspect `Info.plist`, Mach-O architectures, Frameworks, and dynamic-library dependencies, and retain findings and events in a local library.

Version 0.1 turns the flow from import through safe preflight, static inspection, reporting, and an optional experimental launch into something you can test end to end. It does not ship macOS, Apple SDKs, system Frameworks, Rosetta, or proprietary Apple runtime files, and it does not bypass DRM, signatures, licensing, or Apple service authentication. Passing static analysis means only that the file structure meets the current inspection rules; it is not a compatibility guarantee.

### Download and install

Download MVM from the [latest Release page](https://github.com/Watertube-bilibili/MVM/releases/latest). Release binaries are not stored in the source repository.

| File | Purpose |
|---|---|
| [MVM-Setup-0.1.0.exe](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/MVM-Setup-0.1.0.exe) | Recommended. Per-user NSIS installer with a selectable directory and optional desktop/Start shortcuts; administrator rights are not required. |
| [MVM-Portable-0.1.0.exe](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/MVM-Portable-0.1.0.exe) | Portable build. Put it in a normal writable directory and run it without installing; application data still uses the Windows user-data directory. |
| [SHA256SUMS.txt](https://github.com/Watertube-bilibili/MVM/releases/download/v0.1.0/SHA256SUMS.txt) | SHA-256 checksums for both v0.1.0 executables. |

The v0.1.0 binaries are not commercially code-signed, so Windows SmartScreen may show “Windows protected your PC” or an unknown-publisher warning. First confirm that the file came from this repository's Release and verify it in PowerShell:

```powershell
Get-FileHash '.\MVM-Setup-0.1.0.exe' -Algorithm SHA256
Get-FileHash '.\MVM-Portable-0.1.0.exe' -Algorithm SHA256
Get-Content '.\SHA256SUMS.txt'
```

Expected values:

```text
AABE01623DB9A1AFAD8CED2B42757F809A5B7C46C86F0EA8FAE949C83C4C44EE  MVM-Portable-0.1.0.exe
36E5910179487C50B5F76F3F0402D94B9AEFD733C33125638E5D6725E66E3140  MVM-Setup-0.1.0.exe
```

Use SmartScreen's “More info → Run anyway” only when the filename, source, and hash all match. If a hash differs, delete the file and download it again from Releases; do not bypass the warning.

### Five-minute quick start

#### 1. Start with the built-in structural fixture

After the first launch, select the cube button next to the library heading, or choose the structural-fixture action in the empty state. MVM generates an explicitly labeled, non-runnable Universal 2 test bundle and sends it through the real plist and Mach-O analyzers. This verifies the UI, library, four-stage inspection, and report export without requiring a third-party Mac application.

#### 2. Import your own sample

- `.app`: choose **Import** and select a local directory whose name ends in `.app`, or drag it into the window.
- `.dmg`, `.pkg`, `.zip`: choose **Select package** or drag the file into the window.
- Only local drive-letter paths are accepted. UNC shares, network paths, device paths, and extended device paths are rejected before reading.
- Analyze only applications you are authorized to use and test. The fact that MVM can inspect a package does not mean its license permits execution on non-Apple hardware or an alternative runtime.

For an archive import, MVM first copies the source container into its managed data directory, identifies the format, checks member paths and expansion limits, and materializes only the `Info.plist` and main executable needed from the first directly visible `.app`. It does not install the application or reconstruct the full bundle.

#### 3. Read the four inspection stages

The central runway presents these stages in order:

1. **Package**: container type, bundle metadata, entry point, and minimum system version.
2. **Architecture**: thin or universal/fat Mach-O slices such as `x86_64`, `arm64`, and `arm64e`.
3. **Frameworks**: directly loaded Frameworks, dylibs, rpaths, encryption flags, and the presence of code-signature structures.
4. **Backend**: clearly separates static-analysis completion, a missing runtime, and conditional experimental-launch eligibility.

The Findings panel explains blockers, warnings, evidence, and suggested actions. A matching CPU architecture does not imply Cocoa, Metal, XPC, driver, or Apple-service compatibility.

#### 4. Export a report

Select an application and choose **Export report** to save its compatibility JSON. The event area can export all events as JSON. These files help reproduce a problem, but may include absolute local paths, bundle identifiers, hashes, and WSL distribution names. Review and redact them before sharing.

### Optional WSL2 / Darling experiment

Darling and WSL2 are not installed with MVM. First prepare a WSL2 Linux distribution using the [Microsoft WSL documentation](https://learn.microsoft.com/windows/wsl/install), then build or install Darling by following the [upstream Darling project](https://github.com/darlinghq/darling). MVM does not automatically install, update, or modify either component.

1. In PowerShell, confirm that the target distribution is running as WSL2:

   ```powershell
   wsl --list --verbose
   ```

2. Inside that Linux distribution, confirm that Darling is available:

   ```sh
   command -v darling
   darling --version
   ```

3. Return to MVM and select **Probe runtime**. This only discovers a WSL2 distribution and the Darling command. It does not enter a Darling shell or prove that the backend is healthy.
4. Import an `.app` directory directly. The experimental-launch action can become available only when it contains an `x86_64` slice and has no static blocker. DMG, PKG, and ZIP records always remain static-only.
5. When you choose **Try launch**, MVM performs a Darling user-space health check, verifies the complete bundle fingerprint again, reruns the latest static analysis, and only then hands the original `.app` path to the backend.
6. “Command submitted” means only that MVM sent the launch request. Use the actual application window, exit event, and Darling logs to determine whether it ran successfully.

The current experimental path primarily targets `x86_64` applications. ARM64-only software, complex Cocoa GUIs, Metal, drivers, privileged helpers, Apple services, and applications that depend on a particular graphics stack are commonly blocked or nonfunctional. Neither MVM nor Darling is an isolation boundary. Treat a third-party application as untrusted code and use a test account, VM, or dedicated WSL distribution with no sensitive mounts.

### Input capability matrix

| Input | v0.1.0 behavior | Experimental launch |
|---|---|---|
| Direct `.app` directory | Reads the complete bundle from its original path, produces a deterministic manifest SHA-256, and analyzes `Info.plist` and the main Mach-O; the fingerprint and structure are verified again immediately before launch. | **Conditional**: requires `x86_64`, no blocker, and a user-provided WSL2/Darling installation discovered by MVM. |
| `.dmg` | Uses the bundled, fixed-hash 7-Zip for read-only listing and safety preflight, then extracts only the minimum files needed for static analysis. | **No.** Archive imports are static-only. |
| `.pkg` | Performs container listing, safety preflight, and minimal static analysis of a directly visible bundle; it does not recursively install a Payload. | **No.** Archive imports are static-only. |
| `.zip` | Preflights all member paths and extracts only the minimum files needed for static analysis. | **No.** Archive imports are static-only. |
| Local structural fixture | Generates a deterministic test bundle in a unique UUID directory to exercise the real plist/Mach-O pipeline. | **No.** It contains no real application logic. |

> [!CAUTION]
> MVM **never executes a PKG `preinstall`, `postinstall`, or any other installer script**. It also does not bypass protected Mach-O files, DRM, receipts, signatures, or licensing checks.

### Local data, privacy, and security

- MVM itself has no account, telemetry, cloud sync, automatic upload, or automatic download feature. Import, inspection, and report generation happen locally.
- Application records, absolute source paths, findings, and up to 200 event summaries are normally stored in `%APPDATA%\MVM\mvm-state.json`.
- Managed archive copies live under `%APPDATA%\MVM\imports\<id>\`; structural fixtures live under `%APPDATA%\MVM\fixtures\<uuid>\`. The exact location follows the active Windows/Electron environment.
- Removing a record from the library does not delete the original `.app`, DMG, PKG, or ZIP. A managed copy left by a successful archive import is not automatically removed with the record either.
- A third-party application launched through the optional backend may access the network or mounted files on its own. That behavior is outside MVM's privacy guarantees.
- A direct `.app` remains at a mutable, user-controlled source path. MVM verifies a full fingerprint around import and again around launch, but a narrow TOCTOU window remains between the final check and the backend opening the file.
- The bundled 7-Zip binaries are checked against fixed SHA-256 values before use, but the parser still runs as the current user against complex third-party containers. Prefer trusted samples or an isolated test environment.

See the [security notes](docs/SECURITY.md) for the threat model and residual risks. Uninstalling the setup build or deleting the portable executable normally leaves `%APPDATA%\MVM` intact. Exit MVM, verify the exact path, and back up any reports you need before removing that directory.

### Build and test from source

Requirements: Windows 10/11 x64, Node.js 24 or newer, and npm 11 or newer.

```powershell
git clone https://github.com/Watertube-bilibili/MVM.git
Set-Location MVM
npm ci
npm run dev
```

Common verification and packaging commands:

```powershell
npm test
npm run typecheck
npm run build
npm run pack
npm run dist
```

- `npm run pack` produces an unpacked directory build.
- `npm run dist` produces the Windows x64 NSIS installer and portable executable under `release\`.
- Publish release EXEs as GitHub Release assets; do not commit them to Git history.

### Architecture and documentation

The desktop shell uses Electron 43, TypeScript 7, React 19, Fluent UI 9, and Vite 8. The core analyzers handle bounded format recognition, plist, Mach-O, path safety, and read-only 7-Zip preflight. The Electron main process owns persistence, IPC, and optional WSL/Darling orchestration.

- [Architecture](docs/ARCHITECTURE.md)
- [Compatibility model](docs/COMPATIBILITY.md)
- [Testing guide](docs/TESTING.md)
- [Security and privacy](docs/SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [UI design system](DESIGN.md)

### Reporting feedback

Open a [GitHub Issue](https://github.com/Watertube-bilibili/MVM/issues/new) and include as much of the following as possible:

- Windows version, MVM version, and installation type;
- reproducible steps, expected behavior, and actual behavior;
- input type and Mach-O architecture;
- relevant MVM report/events; when using the experimental backend, also include `wsl --list --verbose` and `darling --version` output;
- necessary screenshots or logs.

Do not upload applications, installers, proprietary binaries, secrets, or personal data that you are not authorized to distribute. JSON and logs may contain local paths; redact them before posting.
