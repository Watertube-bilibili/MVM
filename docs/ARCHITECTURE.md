# MVM 技术预览版架构

> 状态：一代实现基线
>
> 核查日期：2026-08-09
>
> 目标平台：Windows 10/11 x64
> 产品性质：macOS 应用导入、诊断与多后端运行实验平台

## 1. 技术预览边界

MVM 一代交付一条真实、可审计的完整流程：用户拖入 `.dmg`、`.pkg` 或 `.app`，MVM 安全地识别和展开内容，定位应用 Bundle，分析 Mach-O、依赖、签名结构和运行要求，将结果保存到应用库，并在存在实际可用后端时尝试启动。

一代明确不把下列事情伪装成已经实现：

- 静态分析通过不等于应用可运行。
- 进程创建成功不等于窗口已经显示，也不等于应用功能正常。
- CPU 指令集匹配不等于 Darwin API、Cocoa、XPC、图形或系统服务兼容。
- MVM 不随包提供 macOS、Apple SDK、Rosetta、恢复镜像、系统 Framework 或 dyld shared cache。
- MVM 不解密受保护的 Mach-O，不绕过代码签名、收据、DRM 或 Apple 服务认证。
- MVM 不在 Windows 主机上执行 PKG 的 `preinstall`、`postinstall` 或其他安装脚本。

因此，产品对外使用三个相互独立的结论：

1. **可分析**：输入已被安全解析，并生成了结构化报告。
2. **可由某后端尝试**：具体后端的能力探测和静态规则均允许发起启动。
3. **实际运行结果**：由后端返回的进程、窗口、退出码和日志证明。

## 2. 总体分层

```text
┌────────────────────────────────────────────────────────────┐
│ Windows 桌面壳：拖放、应用库、报告、设置、运行与日志 UI    │
├────────────────────────────────────────────────────────────┤
│ Application Service：任务编排、持久化、事件与状态机         │
├──────────────────────┬─────────────────────────────────────┤
│ Import/Analysis      │ Compatibility Planner               │
│ 解包、Bundle、Mach-O │ 规则、后端能力匹配、运行计划          │
├──────────────────────┴─────────────────────────────────────┤
│ Runtime Broker：JSON-RPC 后端注册、探测、启动、停止、日志    │
├──────────────┬───────────────┬──────────────┬──────────────┤
│ Portable     │ Darling/WSL2  │ Remote Mac   │ WinDarwin R&D│
│ Adapter      │ Experimental  │ Optional     │ Future       │
└──────────────┴───────────────┴──────────────┴──────────────┘
```

各层只能通过版本化数据对象通信。UI 不直接调用解包程序、`wsl.exe`、SSH 或任意应用可执行文件；这些操作全部由受限的服务或后端进程完成。

## 3. 桌面壳与应用服务

桌面壳负责：

- 拖放和等价的文件/文件夹选择入口；
- 导入进度、应用库、兼容性报告和运行日志；
- 后端安装、授权与健康状态；
- 明确区分“示例数据”“静态推断”和“实际运行结果”；
- 键盘操作、焦点、屏幕阅读器标签和非颜色状态表达。

应用服务负责：

- 为每次导入和运行分配不可变 ID；
- 串联导入、分析、规则评估和后端调用；
- 将状态变化写入持久化存储；
- 生成可导出的 JSON 报告和纯文本日志；
- 应用取消、超时、进程回收和崩溃恢复策略。

Web 渲染器必须启用上下文隔离，不暴露 Node、Shell 或任意路径执行能力。渲染器只能通过窄化、类型化的 IPC 请求应用服务。

## 4. 导入与虚拟文件层

### 4.1 不可变输入

原始输入先被复制或登记为只读源，并计算 SHA-256。一次导入至少保存：

- `importId`；
- 原始路径、类型、大小和 SHA-256；
- 导入时间与 MVM 版本；
- 解包器及其版本；
- 所有警告、资源限额和失败阶段。

同一哈希可以复用分析缓存，但不能复用另一个输入的授权或实际运行结论。

### 4.2 解包器

首代使用随应用分发的完整 `7z.exe + 7z.dll`，不能以只支持少量格式的 `7za.exe` 代替。截至 2026-06-25，7-Zip 26.02 官方列出的只读格式包含 APFS、DMG、HFS、XAR 和 CPIO，能覆盖常见 Mac 应用镜像和 flat PKG；格式支持仍不代表每个加密、损坏或非标准样本都可展开。[7-Zip 26.02 格式列表](https://www.7-zip.org/)、[7z 与 7za 的官方说明](https://sourceforge.net/p/sevenzip/discussion/45798/thread/e7c6028e/)

展开必须采用“两阶段”策略：

1. **列表阶段**：枚举成员、属性、声明大小和嵌套容器，不写出文件。
2. **提取阶段**：只有列表通过策略检查后，才在一次性隔离目录中提取允许的成员。

按文件魔数而不是扩展名递归识别容器，设置固定上限：

- 最大嵌套深度；
- 最大成员数；
- 单文件和总展开大小；
- 最大路径长度；
- 单次任务 CPU、内存和持续时间。

任何绝对路径、`..` 穿越、UNC 路径、设备名、NTFS Alternate Data Stream、越界符号链接、硬链接逃逸和大小写冲突都必须被阻断并记录证据。

### 4.3 格式处理

#### DMG

- 读取常见 UDIF/分区容器；
- 递归进入 HFS+ 或 APFS 内容；
- 忽略指向 `/Applications` 的 Finder 别名；
- 定位一个或多个 `.app` Bundle；
- 加密、未知压缩或解析失败时保留原包并返回明确诊断，不调用系统挂载。

#### PKG

- flat PKG 按 XAR → `Distribution`/`PackageInfo` → `Payload` 解析；
- 旧式目录 PKG 识别 `Contents`、PAX/CPIO Payload；
- 列出 BOM、脚本、目标路径、包标识和版本；
- 只从 Payload 中静态提取候选应用；
- 发现系统级文件、LaunchDaemon、特权 Helper、驱动或脚本时标记为多组件安装，不能宣称单独 `.app` 完整。

Apple 将 PKG 定义为可包含多个组件、固定安装位置和自定义安装代码的分发容器。[Apple：Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) Apple 工程师提供的官方示例也展示了 XAR、BOM、Payload 和 PackageInfo 的关系。[Apple Developer Forums：PKG 内部结构](https://developer.apple.com/forums/tags/apple-archive)

#### APP

- `.app` 是标准目录 Bundle，不假设主程序与目录同名；
- 从 `Contents/Info.plist` 的 `CFBundleExecutable` 解析入口；
- 同时识别 XML 和 binary plist；
- 扫描 `Frameworks`、`PlugIns`、`XPCServices`、`Helpers`、`Library/SystemExtensions` 等嵌套代码；
- 直接从 Windows 文件夹导入时，如果 POSIX 权限、符号链接或扩展属性已丢失，应显示元数据完整性警告。

Apple 的 Bundle 文档说明 `.app` 本质是具有标准层次的目录，并以 Info.plist 描述 Bundle。[Apple Bundle Programming Guide](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/AboutBundles/AboutBundles.html)

### 4.4 文件系统保真

NTFS 与 HFS+/APFS 在大小写、Unicode 归一化、符号链接、权限和扩展属性上不完全等价。Windows 侧可以保存用于 UI 浏览的安全展开副本，但运行后端不能默认把它视为原始 Bundle 的逐字节等价物。

Darling 后端应从不可变原包直接在 WSL ext4 中重新展开，或使用能保留链接和 POSIX 元数据的归档中间层。不得把 Windows 中已扁平化的 `.app` 直接标为“签名完整”。

## 5. Bundle 与 Mach-O 分析

### 5.1 Bundle 元数据

至少读取：

- `CFBundleIdentifier`；
- `CFBundleExecutable`；
- `CFBundleName` / `CFBundleDisplayName`；
- `CFBundleShortVersionString` / `CFBundleVersion`；
- `LSMinimumSystemVersion`；
- `LSArchitecturePriority`；
- `LSRequiresNativeExecution`；
- `LSUIElement`；
- 文档类型、URL Scheme 和关键权限描述。

### 5.2 Mach-O

首代分析器必须支持 thin、fat/universal 和嵌套 Mach-O，至少解析：

- `x86_64`、`arm64`、`arm64e`，以及只做报告的旧 `i386`；
- header、file type、flags、segment 和 section；
- `LC_MAIN`；
- `LC_LOAD_DYLIB`、weak load、re-export 和 `LC_RPATH`；
- `LC_BUILD_VERSION` / 旧 minimum-version 命令；
- `LC_CODE_SIGNATURE`；
- `LC_ENCRYPTION_INFO` / `LC_ENCRYPTION_INFO_64`；
- `LC_DYLD_CHAINED_FIXUPS`、exports trie、UUID。

Apple 的公开 XNU 头文件定义了 Mach-O header、文件类型和 load commands；LLVM 也提供跨平台的 Mach-O 与 universal binary 读取接口。[Apple XNU `mach-o/loader.h`](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h)、[LLVM MachOUniversalBinary](https://llvm.org/doxygen/classllvm_1_1object_1_1MachOUniversalBinary.html)

所有整数、偏移、成员数量和字符串范围都必须在访问前验证。解析错误属于输入诊断，不能使桌面主进程崩溃。

### 5.3 签名与加密

Windows 侧报告分为：

- 是否存在 `LC_CODE_SIGNATURE`；
- SuperBlob、CodeDirectory 和 entitlements 是否可结构化解析；
- 声明的 Team ID、Identifier、flags 和证书摘要；
- 内容哈希是否在 MVM 能覆盖的范围内一致。

这些结果不能称为 Apple 信任验证。只有真实 macOS 后端调用平台验证工具后，才可报告“平台验证通过”。Apple 的代码签名说明也强调 Mach-O 的 `LC_CODE_SIGNATURE` 与 Bundle 内部资源共同参与完整性判断。[Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/)

若加密命令中的 `cryptid != 0`，生成硬阻断 `MACHO_ENCRYPTED`。MVM 不尝试解密。

## 6. 兼容性规划器

规划器的输入是分析清单和各后端实时 `probe` 结果，输出是按后端分别计算的运行计划。它不输出没有证据支撑的“全局兼容百分比”。

每条诊断包含：

```json
{
  "code": "FRAMEWORK_MISSING",
  "severity": "blocker",
  "scope": "backend",
  "backendId": "darling-wsl",
  "message": "Darling 运行时没有声明该 Framework 可用",
  "evidence": {
    "path": "Example.app/Contents/MacOS/Example",
    "loadCommand": "LC_LOAD_DYLIB",
    "value": "/System/Library/Frameworks/AVKit.framework/Versions/A/AVKit"
  }
}
```

规则结果只能是：

- `eligible`：没有已知硬阻断，可发起实际尝试；
- `experimental`：允许尝试，但存在高风险或覆盖未知；
- `ineligible`：该后端存在确定阻断；
- `unavailable`：后端未安装、未授权或健康检查失败。

动态 `dlopen`、Objective-C selector、XPC 和运行时生成依赖无法由静态分析完全发现，因此 `eligible` 也不是功能保证。

## 7. Runtime Broker 与 JSON-RPC 接口

### 7.1 传输和版本

- 协议采用 JSON-RPC 2.0；
- 本机后端默认使用受限命名管道；开发模式可以使用逐行 JSON 的 stdin/stdout；
- 每条消息有最大尺寸，日志通过游标分页，不嵌入无限文本；
- Broker 启动后端进程并继承 Job Object，桌面渲染器不能直接连接后端；
- 后端通过 `backend.hello` 协商 `protocolVersion`，不兼容时停止调用。

共同 envelope：

```json
{
  "jsonrpc": "2.0",
  "id": "01J...",
  "method": "backend.probe",
  "params": {
    "protocolVersion": "1.0",
    "requestId": "01J..."
  }
}
```

### 7.2 方法

#### `backend.hello`

返回后端身份和协议范围：

```json
{
  "backendId": "darling-wsl",
  "backendVersion": "0.1.20260608-mvm.1",
  "protocolMin": "1.0",
  "protocolMax": "1.0",
  "displayName": "Darling / WSL2"
}
```

#### `backend.probe`

只读检查安装、架构、显示和运行时健康状态：

```json
{
  "availability": "available",
  "health": "degraded",
  "hostArchitectures": ["x86_64"],
  "guestArchitectures": ["x86_64"],
  "features": ["cli", "basic-cocoa", "wslg"],
  "limitations": ["complex-gui-unsupported", "arm64-unsupported"],
  "evidence": [
    { "key": "wslVersion", "value": "2" },
    { "key": "darlingVersion", "value": "0.1.20260608" }
  ]
}
```

#### `backend.prepare`

接收 `importId`、`bundleId`、不可变源引用和运行策略，建立后端私有副本或 Prefix。返回 `runtimeInstanceId`、所选架构、准备日志和是否需要用户动作。后端不得接受任意 Shell 字符串。

#### `backend.launch`

```json
{
  "runtimeInstanceId": "01J...",
  "executableRelativePath": "Contents/MacOS/Example",
  "arguments": [],
  "environment": {},
  "timeoutMs": 30000,
  "windowObservation": "best-effort"
}
```

返回 `runId` 和初始状态。返回成功只代表请求被后端接受，不代表应用已运行。

#### `backend.getRunStatus`

返回运行状态、PID（如可公开）、时间戳、退出码、信号/异常、窗口观测和最新日志游标。

#### `backend.stop`

先请求正常终止，超时后才按后端策略强制终止；必须只作用于该 `runId` 的受管进程树。

#### `backend.collectLogs`

按 `runId` 和游标分页返回 stdout、stderr、loader、runtime 和 Broker 日志。每条日志标注来源和时间。

#### `backend.cleanup`

清理一次性准备内容。持久应用 Prefix 的删除必须由单独用户动作触发。

### 7.3 错误

JSON-RPC 标准错误之外，`error.data` 至少包含稳定的 MVM 错误码：

- `BACKEND_UNAVAILABLE`；
- `BACKEND_VERSION_MISMATCH`；
- `PREPARE_FAILED`；
- `ARCHITECTURE_UNSUPPORTED`；
- `POLICY_BLOCKED`；
- `LAUNCH_REJECTED`；
- `PROCESS_CRASHED`；
- `TIMEOUT`；
- `USER_ACTION_REQUIRED`。

错误消息可本地化，但错误码和结构不可随文案变化。

## 8. 状态机与成功定义

### 8.1 导入状态

```text
queued
  └─> validating
        ├─> rejected
        └─> extracting
              ├─> failed
              └─> analyzing
                    ├─> failed
                    └─> ready
```

- `ready` 仅表示报告和应用库记录已生成。
- `rejected` 表示安全策略或不支持输入，不能自动重试。
- `failed` 必须保留失败阶段、工具版本和日志。

### 8.2 运行状态

```text
unavailable | ineligible | eligible
                           └─> preparing
                                 ├─> failed
                                 └─> starting
                                       ├─> failed
                                       └─> process_started
                                             ├─> window_observed
                                             │     └─> running
                                             ├─> running
                                             ├─> exited
                                             └─> crashed

preparing | starting | process_started | window_observed | running
  └─> stopping ─> stopped
```

用户界面必须按事实显示：

- `process_started`：后端确认创建了进程；
- `window_observed`：后端观察到了属于该运行的顶层窗口；
- `running`：进程仍存活，但不保证全部功能；
- `exited`：正常或非崩溃退出，并显示退出码；
- `crashed`：后端获得崩溃、异常或信号证据；
- `stopped`：用户或策略终止。

只有 `window_observed` 才能显示“窗口已出现”。任何状态都不能自动升级为“完全兼容”。

## 9. 运行后端

### 9.1 Portable Payload Adapter

该后端不是 Mach-O 兼容层，只处理包中明确存在的跨平台或 Windows 载荷，例如：

- Windows PE 可执行文件；
- 经规则确认无平台原生库的纯 Java 入口；
- 明确声明可离线加载的 Web 资源。

Electron `app.asar`、Python、Mono 等重托管必须是独立实验适配器。版本不匹配、Darwin native module、平台分支或许可证不明确时，不得自动运行或修改原 Bundle。

### 9.2 Darling / WSL2

Darling 是当前最可信的本地实验后端。其官方文档说明 WSL2 应可按标准 Linux 方式运行，且项目已不再依赖 Linux 内核模块；WSL1 当前不可用。[Darling：Building for the WSL](https://docs.darlinghq.org/wsl-build.html)

截至 2026-08-09，最新正式发行版为 2026-06-09 的 `v0.1.20260608`。[Darling release v0.1.20260608](https://github.com/darlinghq/darling/releases/tag/v0.1.20260608) 官方构建要求仍以 64 位 x86 Linux 为基础。[Darling Build Instructions](https://docs.darlinghq.org/build-instructions.html)

同时必须保留官方兼容性边界：项目明确写明绝大多数复杂 GUI、Adobe、Final Cut、Logic、Xcode GUI 和多种 GUI Toolkit 当前不可运行，只有极简单 GUI 例外。[Darling Known non-functional software](https://docs.darlinghq.org/known-nonfunctional-software.html)

#### 安装策略

- Darling 是可选 Runtime Pack，不进入默认轻量安装包。
- 不修改或依赖用户已有 Ubuntu；导入独立的 `MVM-Darling` WSL2 发行版。
- Runtime Pack 在匹配的 Linux 环境中预构建，固定 Darling 安装前缀。官方文档说明其安装前缀会硬编码，安装目录不能事后随意移动。[Darling Build Instructions](https://docs.darlinghq.org/build-instructions.html#custom-installation-prefix)
- 首次安装 WSL、启用虚拟化、下载 Runtime Pack 和创建发行版均需要显式用户确认。
- 后端 `probe` 必须实际验证 WSL2、发行版、overlayfs、Darling、x86_64 和显示环境。
- WSLg 可将 Linux 的 X11/Wayland 窗口集成到 Windows 桌面；它只解决窗口投射，不提高 Darling 的 Cocoa/Framework 兼容度。[Microsoft：Run Linux GUI apps with WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)、[WSLg 项目](https://github.com/microsoft/wslg)
- 每个应用使用独立 `DPREFIX`。Darling 官方将 Prefix 定义为类似 Wine Prefix、基于 overlayfs 的虚拟根。[Darling Prefix](https://docs.darlinghq.org/darling-prefix.html)
- PKG 脚本仍不执行。需要系统安装语义的包在首代只分析。
- ARM64/ARM64e-only 应用不能交给该后端；universal 应用只选择其 x86_64 slice。

#### 卸载策略

卸载桌面壳默认保留 `MVM-Darling` 和用户 Prefix。删除 WSL 发行版会永久删除其中应用数据，必须在独立页面列出影响、提供导出，并要求二次确认；安装器卸载流程不得静默调用 `wsl --unregister`。

### 9.3 Remote Mac

Remote Mac 后端由用户配置其拥有或获准使用的 Apple Mac：

- 通过 SSH 上传不可变源或 Bundle；
- 在 Mac 上执行平台签名验证、安装和启动；
- 返回进程、窗口、退出和系统日志；
- GUI 交互由用户选择 Screen Sharing、VNC 或其他合规远程桌面。

该后端兼容性潜力最高，但 UI 必须标为“在远程 Mac 运行”，不能称为 Windows 原生执行。云端方案必须使用真实 Apple 硬件；例如 AWS 官方说明 EC2 Mac 是 Dedicated Host 上的裸金属 Mac，且有至少 24 小时分配周期。[AWS EC2 Mac instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html)

### 9.4 明确排除的本地后端

#### QEMU user-mode

QEMU 官方将 user-mode 定义为在相同操作系统上跨 CPU 运行程序，正式列出的用户态系统是 Linux 和 BSD；它没有 Darwin-on-Windows 系统调用层。[QEMU User Mode](https://www.qemu.org/docs/master/user/main.html) 因此它只能作为未来 ARM 指令翻译组件的候选，不能单独运行 Mac 应用。

#### 普通 Windows PC 上的 macOS VM

QEMU system emulation 可以模拟完整机器，Windows 构建也可使用 WHPX，但这不赋予 macOS 安装许可。[QEMU System Emulation](https://www.qemu.org/docs/master/system/introduction.html)、[QEMU Invocation / accelerators](https://www.qemu.org/docs/master/system/invocation.html)

macOS Tahoe 26 许可将系统使用限定在 Apple-branded systems，并将额外虚拟实例授权建立在已经运行 macOS 的 Apple-branded computer 上。因此普通 Windows PC 上的 macOS 镜像不进入 MVM 官方安装、下载或支持路径。[Apple macOS Tahoe 26 SLA](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)

#### Rosetta

Rosetta 2 解决的是 Apple Silicon Mac 上的 x86_64 到 ARM64 翻译，不提供 Darwin API 到 Windows API 的兼容。Apple 的安全架构说明其 JIT 由 macOS 内核装载路径接管，AOT 产物由受限系统服务、Secure Enclave 设备密钥和 Data Vault 保护，技术上也不是可抽取的通用后端。[Apple Platform Security：Rosetta 2](https://support.apple.com/guide/security/secebb113be1/web)

Apple 在 2026-02 的支持文档中说明 Rosetta 会维持到 macOS 27，而从 macOS 28 起只为部分依赖 Intel Framework 的旧游戏保留有限功能；MVM 不依赖 Rosetta 路线。[Apple：Using Intel-based apps on a Mac with Apple silicon](https://support.apple.com/en-gb/102527)

## 10. Windows 原生 Darwin 后端长期路线

Windows 原生层保持为独立研究后端，不阻塞一代产品。建议按可验证增量推进：

### 阶段 A：x86_64 Mach-O Loader

- 仅运行无系统依赖的 freestanding 测试 Mach-O；
- 映射 segment、保护属性和入口点；
- 实现 rebase、bind、exports、chained fixups 和 `@rpath`；
- 处理 TLS、unwind、异常、信号与 macOS SysV ABI / Windows x64 ABI 桥。

### 阶段 B：Darwin 基础运行时

- 自有 `libSystem` 兼容导出；
- BSD syscall 映射；
- `darwinserver.exe` 实现 Mach port、task/thread、kqueue 和进程协调；
- dyld 兼容装载和替代系统库图。

Darling 的架构可作为重要参考：`mldr` 负责 Mach-O 与 dyld 装载，修改后的 `libsystem_kernel` 和用户态 `darlingserver` 实现 Darwin/XNU 行为。[Darling Loader](https://docs.darlinghq.org/internals/basics/loader.html)、[Darling System call emulation](https://docs.darlinghq.org/internals/basics/system-call-emulation.html)、[darlingserver](https://docs.darlinghq.org/internals/darlingserver/index.html)

### 阶段 C：Objective-C 与核心 Framework

- Objective-C runtime；
- CoreFoundation、Foundation；
- launchd/XPC 子集；
- preferences、Keychain、通知与文件协调。

GNUstep 可为 Cocoa API 的源码级行为和 Windows 后端提供参考，但其官方目标是 Cocoa 源码兼容和重新编译，不是任意 Apple Mach-O 二进制运行时。[GNUstep](https://www.gnustep.org/)、[GNUstep Windows MSVC Toolchain](https://developer.gnustep.org/Guides/Setup/Windows/installing-windows-msvc.html)

### 阶段 D：GUI 与媒体

- AppKit/CoreGraphics/CoreText → Direct2D/DirectWrite 或 Skia；
- Metal → Vulkan/D3D12；
- CoreAudio → WASAPI；
- 图像、视频、输入法、剪贴板、菜单和辅助功能。

### 阶段 E：ARM64

- Windows ARM64 原生 ABI 桥；
- x64 Windows 上的 ARM64 DBT；
- `arm64e` 指针认证语义单独研究。

CPU 翻译必须是可替换组件，不能与 Darwin API 兼容度混为同一个“架构支持”开关。

## 11. 安全边界

### 11.1 输入威胁模型

任何 DMG、PKG、APP、plist 和 Mach-O 都视为不可信，包括用户自己下载的文件。主要风险：

- 解包器和解析器漏洞；
- archive bomb；
- 路径穿越与链接逃逸；
- 恶意 plist 长度、Mach-O offset 和 load command；
- PKG 任意安装脚本；
- 导入内容伪装成图标、日志或报告附件；
- 应用启动后的网络、文件、凭据和子进程访问。

### 11.2 进程隔离

- 解包器与解析器使用独立低权限进程；
- Job Object 限制内存、CPU、子进程和持续时间；
- 导入阶段默认无网络；
- 工作目录是一次性、随机且位于 MVM 私有根目录；
- Broker 只向后端传递受验证的相对路径和 opaque ID；
- 不拼接 Shell 命令，不接受后端返回的任意宿主路径执行请求；
- 取消、超时和桌面壳退出时回收全部受管进程。

### 11.3 运行隔离

- 每个应用独立 Prefix/实例；
- 默认只映射用户明确选择的文件，不映射整个用户目录；
- 网络、摄像头、麦克风、剪贴板和共享目录按后端能力单独显示；
- 特权 Helper、kext、System Extension 和驱动一代均阻断；
- 运行日志不得记录密码、令牌或完整环境变量。

## 12. 许可与分发边界

本节是产品工程政策，不替代法律意见。

- 用户必须对导入应用拥有使用权；第三方应用受各自 EULA 约束。
- Mac App Store 标准 EULA 将应用使用范围限定在 Apple-branded 产品；MVM 应提醒用户检查来源许可。[Apple Licensed Application Standard EULA](https://www.apple.com/legal/macapps/stdeula/)
- 不分发或引导提取 macOS、Apple SDK、Rosetta、Apple 私有 Framework、系统字体、声音、恢复镜像或 dyld shared cache。
- 不把用户从 Mac 提取的 Apple 系统文件作为 Windows Runtime。
- 7-Zip 以独立工具分发并附带其 LGPL/BSD/unRAR 通知和源码链接。[7-Zip License](https://www.7-zip.org/license.txt)
- Darling 主仓库采用 GPL-3.0；分发其二进制 Runtime Pack 时必须提供许可证、第三方通知及相应源码获取方式。[Darling repository](https://github.com/darlinghq/darling)
- Runtime Pack 与桌面壳保持独立进程和独立包，不能用技术边界规避任何许可证义务。
- 不支持在非 Apple 硬件上安装 macOS 的正式流程。

## 13. 安装包组成

### 默认安装包

- MVM 桌面壳与应用服务；
- 完整 7-Zip 解包组件；
- Bundle/plist/Mach-O 分析器；
- 兼容性规则与后端 Broker；
- 示例数据只作为明确标记的 fixture；
- 开源许可证与来源清单。

### 可选 Runtime Pack

- `MVM-Darling` WSL2 发行版；
- Darling 固定版本和运行时清单；
- Runtime Pack 的完整许可证/源码信息；
- 独立安装、修复、导出和删除流程。

Remote Mac 只安装连接器，不附带 macOS。Windows Darwin 研究后端只在其测试门槛满足后作为独立实验组件发布。

## 14. 可观察性与验收

每次运行至少保存：

- `runId`、`importId`、Bundle、后端 ID/版本；
- 所选架构和运行计划摘要；
- 每次状态转换及时间戳；
- 后端进程、loader、stdout/stderr 和窗口观测日志；
- 退出码、异常/信号和用户停止原因；
- 日志脱敏结果。

一代验收标准：

1. `.dmg`、`.pkg`、`.app` 能进入同一安全导入管线。
2. 能生成可复现、可导出的 Bundle/Mach-O/依赖/签名结构报告。
3. 所有“可尝试”均指明具体后端及证据。
4. 未安装运行时也能完整使用分析与应用库功能。
5. Darling 可选后端只对实际 Probe 通过且含 x86_64 slice 的目标开放启动。
6. 运行 UI 能分别显示进程启动、窗口观测、退出与崩溃。
7. 默认安装和便携包都不包含 Apple 专有系统运行时。
