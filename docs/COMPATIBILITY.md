# MVM 技术预览版兼容性规范

> 状态：一代兼容性与诊断基线
>
> 核查日期：2026-08-09
> 关联文档：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 1. 兼容性在 MVM 中的含义

MVM 不使用一个无法证明的总兼容率描述应用。兼容性被拆成五个独立问题：

1. **输入是否可读取**：容器能否安全列出和展开。
2. **应用是否可识别**：能否定位 Bundle、Info.plist 和主可执行文件。
3. **二进制是否可分析**：Mach-O slice、load command、依赖和签名结构能否解析。
4. **某个后端是否有资格尝试**：CPU、运行时、Framework 和策略是否存在已知阻断。
5. **实际发生了什么**：进程是否创建、窗口是否出现、应用是否退出或崩溃。

前四项不构成第五项的保证。静态规则无法完整发现运行时 `dlopen`、Objective-C selector、XPC、私有 API、服务端校验和硬件依赖。

## 2. 状态词汇

### 2.1 分析状态

| 状态 | 含义 |
|---|---|
| `not_analyzed` | 尚未进入分析器 |
| `analyzing` | 正在解析，不能显示最终结论 |
| `analyzed` | 已生成结构化报告，允许存在警告 |
| `partially_analyzed` | 部分内容可读，但存在不支持的容器、Payload、plist 或 Mach-O |
| `rejected` | 安全策略拒绝输入 |
| `analysis_failed` | 工具或解析过程失败，日志已保留 |

### 2.2 后端资格

| 状态 | 含义 | UI 推荐文案 |
|---|---|---|
| `eligible` | 无已知硬阻断，允许实际启动 | 可尝试运行 |
| `experimental` | 允许启动，但存在高风险、stub 或覆盖未知 | 实验性尝试 |
| `ineligible` | 存在确定阻断 | 当前后端不可运行 |
| `unavailable` | 后端未安装、未配置、未授权或健康检查失败 | 后端不可用 |

`eligible` 不是“完全兼容”。只有后端实际返回的运行状态能描述一次运行。

### 2.3 运行状态

| 状态 | 证据要求 |
|---|---|
| `preparing` | 后端已接受准备请求 |
| `starting` | 后端正在创建进程 |
| `process_started` | 后端确认受管进程已创建 |
| `window_observed` | 后端观察到属于该 `runId` 的顶层窗口 |
| `running` | 进程仍存活；不保证功能完整 |
| `exited` | 获得正常/非崩溃退出和退出码 |
| `crashed` | 获得异常、信号、崩溃报告或后端等价证据 |
| `stopped` | 用户或策略完成终止 |
| `run_failed` | 在进程创建前失败 |

UI 不得把 `process_started` 写成“应用已正常运行”，也不得在没有窗口观测能力时推测窗口出现。

## 3. 输入格式支持矩阵

| 输入 | 一代读取 | 一代静态分析 | 一代执行语义 | 说明 |
|---|---:|---:|---:|---|
| 标准 `.app` 文件夹 | 是 | 是 | 交给后端 | Windows 来源可能已丢失 POSIX/链接元数据 |
| HFS+ DMG | 是 | 是 | 提取应用后交给后端 | 常见只读镜像 |
| APFS DMG | 是 | 是 | 提取应用后交给后端 | 取决于解包器对具体 APFS 特性的覆盖 |
| 多分区 DMG | 部分 | 部分 | 条件式 | 逐分区识别，未知文件系统保留诊断 |
| 加密/密码 DMG | 检测 | 否或部分 | 否 | 一代不负责解密工作流 |
| flat XAR PKG | 是 | 是 | 只提取，不执行安装脚本 | 支持 Distribution、PackageInfo、BOM、Payload 清单 |
| 旧式目录 PKG | 部分 | 部分 | 只提取 | 识别常见 PAX/CPIO 载荷 |
| 非标准/未知 PKG Payload | 外层可读 | 部分 | 否 | 返回 `PKG_PAYLOAD_UNSUPPORTED` |
| PKG 中的安装脚本 | 列出/散列 | 是 | 否 | 永远不在 Windows 主机执行 |
| ZIP/TAR 中的 `.app` | 是 | 是 | 条件式 | 作为辅助输入，不改变 Bundle 规则 |
| macOS 恢复镜像、IPSW | 否 | 否 | 否 | 不属于 MVM 应用导入范围 |

截至 2026-06-25，7-Zip 26.02 官方支持只读展开 APFS、DMG、HFS、XAR 和 CPIO；这里的矩阵以该能力为首代解包基础，不承诺所有损坏、加密或未来格式变体。[7-Zip 官方格式列表](https://www.7-zip.org/)

Apple 说明 DMG、PKG 和 ZIP 是 macOS 常见分发容器，其中 PKG 适合多组件、固定路径和自定义安装代码。[Apple：Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

## 4. CPU 与 Mach-O 支持矩阵

| Mach-O 架构 | 分析器 | Portable Adapter | Darling/WSL2 | Remote Mac | Windows Darwin R&D |
|---|---:|---:|---:|---:|---:|
| `x86_64` | 完整目标 | 仅另有可移植载荷 | 实验支持 | 取决于远程 Mac/macOS | 第一研发目标 |
| `i386` | 报告 | 否 | 默认关闭；仅特制 multilib runtime | 现代 macOS 通常不支持 | 非优先 |
| `arm64` | 完整目标 | 仅另有可移植载荷 | 不支持 | Apple Silicon Mac 条件支持 | 后续阶段 |
| `arm64e` | 识别并报告 | 否 | 不支持 | 由目标 Mac 和应用决定 | 单独研究 |
| universal `x86_64+arm64` | 分 slice 分析 | 条件式 | 选择 `x86_64` | 由远程 Mac 选择 | 分阶段 |
| 无可执行 slice | 报告阻断 | 否 | 否 | 否 | 否 |

Darling 当前官方构建仍要求 64 位 x86 Linux，因此 MVM 的 Darling 后端只声明 `x86_64` guest 能力。[Darling Build Instructions](https://docs.darlinghq.org/build-instructions.html) Apple 的公开 `mach-o/loader.h` 是 MVM 识别 CPU、file type 与 load command 的格式依据。[Apple XNU Mach-O header](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h)

CPU 架构诊断和系统 API 诊断必须分开。存在 x86_64 slice 只说明 CPU 指令可作为 Darling 候选，不说明 AppKit、Metal、XPC 或 Framework 已兼容。

## 5. 运行后端支持矩阵

### 5.1 后端总览

| 后端 | 一代状态 | 真实执行位置 | 适用对象 | 不适用对象 |
|---|---|---|---|---|
| Analyzer Only | 默认可用 | Windows | 所有可解析输入 | 不执行应用 |
| Portable Payload Adapter | 内置、严格匹配 | Windows 或受限 WSL | 包内 PE、纯 Java、明确 Web 载荷 | 任意 Mach-O 本体 |
| Darling / WSL2 | 可选实验 | WSL2 Linux 用户态 | x86_64 CLI、少量简单 Cocoa | ARM64-only、复杂 GUI、驱动、Apple 服务密集应用 |
| Remote Mac | 可选连接器 | 用户授权的 Apple Mac | 与远程系统匹配的正常 Mac 应用 | 未配置、许可不明或远程系统不支持的应用 |
| Windows Darwin | 研究接口 | Windows | 初期 freestanding/x86_64 测试 | 一代普通用户应用 |

Darling 官方说明 WSL2 可使用标准 Linux 安装路径，WSL1 当前不可用。[Darling WSL 文档](https://docs.darlinghq.org/wsl-build.html) WSLg 能把 X11/Wayland GUI 投射到 Windows，但不提供 Cocoa API 兼容。[Microsoft WSL GUI 文档](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)

### 5.2 应用类型

| 应用类型 | Analyzer | Portable | Darling/WSL2 | Remote Mac | 预期结论 |
|---|---:|---:|---:|---:|---|
| x86_64 POSIX/Darwin CLI | 是 | 条件式 | 实验，优先候选 | 是 | Darling 最现实的本地目标 |
| 简单 AppKit/Cocoa 示例 | 是 | 否 | 实验、低保证 | 是 | 可尝试，必须观测窗口 |
| 复杂 AppKit 文档应用 | 是 | 否 | 高风险/通常不合格 | 是 | 默认建议 Remote Mac |
| Electron Mac 应用 | 是 | 重托管条件式 | 通常高风险 | 是 | native module/版本检查后决定 |
| Qt/wxWidgets/Tk/MAUI Mac GUI | 是 | 仅厂商另带 Windows 目标 | Darling 官方列为多数不可用 | 是 | Darling 默认阻断或高风险 |
| Metal/OpenGL 重度应用 | 是 | 否 | 一代不合格 | 是 | 需要真实 Mac |
| 音视频制作、Adobe、Xcode GUI | 是 | 否 | Darling 官方列为不可用 | 是 | Remote Mac 或仅分析 |
| 需要 XPC/launchd 服务 | 是 | 否 | 依覆盖度，通常高风险 | 是 | 报告具体服务依赖 |
| 需要 kext/System Extension | 是 | 否 | 否 | 由 Mac 与权限决定 | 本地后端硬阻断 |
| 需要特权 Helper/LaunchDaemon | 是 | 否 | 一代不执行安装语义 | 条件式 | PKG 静态分析，不本地安装 |
| 加密/App Store 收据绑定 | 结构分析 | 否 | 否 | 由合法取得方式和平台决定 | 不绕过保护 |
| 包内 Windows PE | 是 | 是 | 无需 Darling | 可选 | 运行 PE，不称为 Mach-O 兼容 |
| 纯 Java、无 JNI | 是 | 条件式 | 可选 | 是 | 需精确入口和 JRE 策略 |

Darling 官方当前明确列出：GUI 应用只有极少数简单例外，多数 Toolkit、Xcode GUI、Logic、Final Cut、Adobe 和一般复杂 GUI 均不可运行。[Darling Known non-functional software](https://docs.darlinghq.org/known-nonfunctional-software.html)

## 6. Framework 与系统能力分级

MVM 不维护一个永久不变的“Framework 存在即兼容”列表。每个 Runtime Pack 发布一份版本化能力清单：

```json
{
  "backendId": "darling-wsl",
  "backendVersion": "0.1.20260608-mvm.1",
  "frameworks": {
    "Foundation": { "status": "implemented", "symbolCoverage": "unknown" },
    "AppKit": { "status": "partial", "symbolCoverage": "partial" },
    "SomeFramework": { "status": "stub", "symbolCoverage": "none" }
  }
}
```

允许的状态：

| 状态 | 含义 | 默认规则 |
|---|---|---|
| `implemented` | 后端声明存在真实实现 | 仍可能因缺符号或行为差异降级 |
| `partial` | 已知只有部分 API/行为 | `experimental` |
| `stub` | 仅为满足链接或符号存在 | 使用到关键符号时 `ineligible` |
| `missing` | Framework 不存在 | 强链接时 `ineligible` |
| `unknown` | 清单无信息 | `experimental`，不能当作支持 |

规则必须进一步比较 dylib install name、compatibility version、强/弱链接和所需符号。弱链接 Framework 缺失是警告；强链接 Framework 缺失是阻断。运行时动态依赖继续以实际日志为准。

Darling 的高优先级清单仍列出 AppKit、XPC/launchd、CoreAudio 和 CoreServices 等未完成工作，说明 Framework 名称存在不能直接等同于完整行为。[Darling High priority stuff](https://docs.darlinghq.org/contributing/high-priority-stuff.html)

## 7. 诊断数据模型

每条诊断必须符合：

```ts
type Diagnostic = {
  code: string;
  severity: "info" | "warning" | "blocker" | "fatal";
  scope: "input" | "bundle" | "binary" | "backend" | "run" | "policy";
  backendId?: string;
  title: string;
  message: string;
  evidence: {
    source: "observed" | "declared" | "inferred";
    path?: string;
    offset?: number;
    key?: string;
    value?: unknown;
    tool?: string;
    toolVersion?: string;
  };
  remediation?: string;
};
```

### 严重级别

| 级别 | 含义 |
|---|---|
| `info` | 事实信息，不降低后端资格 |
| `warning` | 未知、元数据损失或高风险；通常降为 `experimental` |
| `blocker` | 对指定 scope/backend 的确定阻断 |
| `fatal` | 输入无法安全继续，终止整次导入或分析 |

### 证据来源

| 来源 | 含义 |
|---|---|
| `observed` | 解析器、后端或运行日志直接观察到 |
| `declared` | Bundle、Mach-O、后端能力清单或用户配置声明 |
| `inferred` | 规则推断，必须展示推断依据 |

稳定逻辑只依赖 `code`、`severity` 和结构化 evidence，不能解析本地化消息文本。

## 8. 诊断码

### 8.1 输入与解包

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `INPUT_NOT_FOUND` | fatal | 源文件在读取前消失 |
| `INPUT_TYPE_UNSUPPORTED` | fatal | 不是允许的容器、Bundle 或辅助归档 |
| `INPUT_CHANGED_DURING_IMPORT` | fatal | 大小、时间或哈希在导入中变化 |
| `ARCHIVE_LIST_FAILED` | fatal | 无法安全列出容器 |
| `ARCHIVE_ENCRYPTED` | blocker | 容器需要未提供或不支持的解密方式 |
| `ARCHIVE_BOMB_LIMIT` | fatal | 展开大小、成员数、压缩比或资源限额超标 |
| `ARCHIVE_NESTING_LIMIT` | fatal | 嵌套容器超过上限 |
| `ARCHIVE_PATH_TRAVERSAL` | fatal | 绝对路径、`..` 或等价穿越 |
| `ARCHIVE_LINK_ESCAPE` | fatal | 符号链接/硬链接逃出隔离根 |
| `ARCHIVE_DEVICE_PATH` | fatal | Windows 设备路径、UNC 或保留设备名 |
| `ARCHIVE_ADS_BLOCKED` | fatal | NTFS Alternate Data Stream 路径 |
| `FILESYSTEM_CASE_COLLISION` | warning | 两个 Mac 路径在目标 Windows 文件系统碰撞 |
| `FILESYSTEM_METADATA_LOST` | warning | 权限、链接、资源叉或扩展属性无法保真 |
| `DMG_FILESYSTEM_UNSUPPORTED` | blocker | DMG 中分区/文件系统无法读取 |
| `DMG_NO_APP_FOUND` | warning | DMG 可读但未发现 `.app` |
| `PKG_PAYLOAD_UNSUPPORTED` | blocker | PKG 外层可读但 Payload 编码不支持 |
| `PKG_SCRIPT_PRESENT` | warning | 包含安装脚本，已列出但未执行 |
| `PKG_SCRIPT_BLOCKED` | blocker | 某运行计划要求执行安装脚本，策略拒绝 |
| `PKG_SYSTEM_PAYLOAD` | warning | Payload 写入 `/Library`、`/usr` 等系统位置 |
| `PKG_MULTICOMPONENT` | warning | 应用依赖 Bundle 外组件，单独提取可能不完整 |

### 8.2 Bundle 与 plist

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `BUNDLE_INFO_MISSING` | blocker | 缺少 `Contents/Info.plist` |
| `PLIST_INVALID` | blocker | XML/binary plist 损坏或越界 |
| `BUNDLE_EXECUTABLE_KEY_MISSING` | blocker | 缺少 `CFBundleExecutable` |
| `BUNDLE_EXECUTABLE_MISSING` | blocker | 声明入口不存在 |
| `BUNDLE_EXECUTABLE_NOT_REGULAR_FILE` | blocker | 入口是目录、逃逸链接或非法对象 |
| `BUNDLE_IDENTIFIER_MISSING` | warning | 缺少 `CFBundleIdentifier` |
| `BUNDLE_NONSTANDARD_LAYOUT` | warning | Bundle 结构偏离标准但仍可分析 |
| `BUNDLE_MULTIPLE_CANDIDATES` | info | 容器内存在多个应用，要求用户选择 |
| `BUNDLE_NESTED_CODE` | info | 发现 Helper、Plugin、XPC Service 或 Framework |
| `BUNDLE_METADATA_INCOMPLETE` | warning | 直接从 Windows 文件夹导入且元数据可能已丢失 |

### 8.3 Mach-O 与架构

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `MACHO_NOT_FOUND` | blocker | 主入口不是 Mach-O，且没有匹配适配器 |
| `MACHO_MALFORMED` | blocker | header、slice、load command 或 offset 非法 |
| `MACHO_FILETYPE_UNSUPPORTED` | blocker | 主入口不是可执行类型 |
| `MACHO_NO_EXECUTABLE_SLICE` | blocker | universal 文件中没有可用可执行 slice |
| `CPU_X86_64_AVAILABLE` | info | 存在 x86_64 slice |
| `CPU_ARM64_AVAILABLE` | info | 存在 arm64 slice |
| `CPU_ARM64_ONLY` | blocker | 对 x86_64-only 后端没有可选 slice |
| `CPU_ARM64E_UNSUPPORTED` | blocker | 后端不支持 arm64e ABI/指针认证语义 |
| `CPU_I386_LEGACY` | warning | 只有或包含旧 32 位 Intel slice |
| `BACKEND_ARCH_UNSUPPORTED` | blocker | 具体后端声明不支持目标 slice |
| `MIN_OS_TOO_NEW` | blocker | 目标最低 OS 高于后端声明的 Darwin/macOS API 代际 |
| `MACHO_ENCRYPTED` | blocker | `LC_ENCRYPTION_INFO(_64).cryptid != 0` |
| `ENTRYPOINT_MISSING` | blocker | 无法解析主入口命令或等价入口 |

### 8.4 签名、权限与保护

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `CODE_SIGNATURE_MISSING` | warning | 未发现嵌入式签名 |
| `CODE_SIGNATURE_STRUCTURAL_ONLY` | info | Windows 仅完成结构检查，未做 macOS 平台信任验证 |
| `CODE_SIGNATURE_MALFORMED` | blocker | 签名 Blob 越界、损坏或内部不一致 |
| `CODE_SIGNATURE_CONTENT_MISMATCH` | blocker | MVM 可验证范围内的内容哈希不一致 |
| `REMOTE_SIGNATURE_NOT_VERIFIED` | warning | Remote Mac 尚未返回平台验证结果 |
| `ENTITLEMENT_SENSITIVE` | warning | 包含需要特殊平台服务/权限的 entitlement |
| `APP_SANDBOX_ASSUMPTION` | warning | 应用假定 macOS App Sandbox 容器语义 |
| `DRM_OR_RECEIPT_REQUIRED` | blocker | 检测到加密、收据或运行时保护依赖，MVM 不绕过 |
| `USER_LICENSE_CONFIRMATION_REQUIRED` | blocker | 需要用户确认其有权使用/传输该应用 |

Windows 上的签名结构检查不能替代 macOS 的 `codesign`/平台信任判断。Apple 说明代码签名同时涉及 Mach-O CodeDirectory 和 Bundle 资源封装。[Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/)

### 8.5 动态链接与 Framework

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `DYLD_DEPENDENCY_UNRESOLVED` | blocker | 强链接 dylib 无法在 Bundle 或后端中解析 |
| `DYLD_WEAK_DEPENDENCY_MISSING` | warning | 弱链接依赖不存在，只有调用时才可能失败 |
| `RPATH_UNRESOLVED` | blocker | `@rpath` 图无法得到目标 |
| `FRAMEWORK_MISSING` | blocker | 后端能力清单明确缺少强链接 Framework |
| `FRAMEWORK_PARTIAL` | warning | 后端只声明部分实现 |
| `FRAMEWORK_STUB_ONLY` | blocker | 所需关键 Framework/符号只有 stub |
| `FRAMEWORK_COVERAGE_UNKNOWN` | warning | 能力清单没有可靠覆盖信息 |
| `PRIVATE_FRAMEWORK` | warning | 链接 Apple 私有 Framework；本地后端通常无法提供 |
| `SYMBOL_MISSING` | blocker | 后端或 Bundle 明确缺少强引用符号 |
| `SWIFT_RUNTIME_REQUIRED` | info | 发现 Swift runtime/overlay 依赖 |
| `NATIVE_PLUGIN_ARCH_MISMATCH` | blocker | Helper/Plugin/Framework 没有与主运行 slice 匹配的架构 |
| `DYNAMIC_LOADING_UNCERTAIN` | warning | 发现 `dlopen`/插件模式，静态图可能不完整 |

### 8.6 macOS 服务、系统组件与硬件

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `XPC_SERVICE_REQUIRED` | warning | 应用包含或依赖 XPC 服务 |
| `LAUNCHD_SERVICE_REQUIRED` | warning | 依赖 launchd agent/daemon |
| `APPLE_SERVICE_REQUIRED` | blocker | 依赖无法替代的 Apple 账户、商店或系统服务 |
| `PRIVILEGED_HELPER_REQUIRED` | blocker | 需要 SMJobBless/特权 Helper 或 root 安装语义 |
| `KEXT_UNSUPPORTED` | blocker | 包含或依赖 kernel extension |
| `SYSTEM_EXTENSION_UNSUPPORTED` | blocker | 本地后端不支持 macOS System Extension |
| `DRIVER_UNSUPPORTED` | blocker | 需要 macOS 驱动或设备栈 |
| `HARDWARE_FEATURE_REQUIRED` | warning | 摄像头、麦克风、GPU、USB 等能力需后端和用户授权 |
| `METAL_REQUIRED` | blocker | 一代 Darling 后端没有足够 Metal 兼容能力 |
| `COREMEDIA_PIPELINE_UNSUPPORTED` | blocker | 依赖未覆盖的专业音视频系统能力 |

### 8.7 后端安装与健康

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `BACKEND_UNAVAILABLE` | blocker | 通用后端不可用 |
| `BACKEND_PROTOCOL_MISMATCH` | blocker | JSON-RPC 协议版本无交集 |
| `BACKEND_CAPABILITY_STALE` | warning | 能力清单与实际版本不匹配 |
| `WSL_NOT_INSTALLED` | blocker | Windows 未安装 WSL |
| `WSL_VERSION_UNSUPPORTED` | blocker | 只有 WSL1 或 WSL2 不可用 |
| `WSLG_UNAVAILABLE` | warning | GUI 投射不可用；CLI 仍可能运行 |
| `MVM_DARLING_DISTRO_MISSING` | blocker | 独立 MVM WSL 发行版未安装 |
| `DARLING_NOT_INSTALLED` | blocker | 发行版内没有 Darling |
| `DARLING_HEALTHCHECK_FAILED` | blocker | Hello World/Prefix/overlayfs 健康检查失败 |
| `DARLING_GUI_HIGH_RISK` | warning | 目标是复杂 GUI，官方兼容现状风险高 |
| `REMOTE_MAC_NOT_CONFIGURED` | blocker | 未配置远程 Mac |
| `REMOTE_MAC_UNREACHABLE` | blocker | 网络、SSH 或认证失败 |
| `REMOTE_MAC_OS_UNSUPPORTED` | blocker | 远程 macOS 版本/架构不满足目标 |
| `REMOTE_USER_ACTION_REQUIRED` | blocker | 远程系统要求登录、许可、安装或安全确认 |

### 8.8 准备与实际运行

| Code | 默认级别 | 含义/触发条件 |
|---|---|---|
| `BACKEND_PREPARE_FAILED` | blocker | 后端无法建立副本、Prefix 或运行实例 |
| `HOST_FILE_SHARE_DENIED` | blocker | 用户未授权所需文件映射 |
| `PROCESS_START_FAILED` | blocker | loader/后端未创建进程 |
| `PROCESS_EXIT_EARLY` | warning | 进程在稳定窗口前快速退出，附退出码 |
| `WINDOW_NOT_OBSERVED` | warning | 观察期内没有窗口；CLI 目标可忽略 |
| `PROCESS_CRASHED` | blocker | 获得崩溃证据 |
| `RUN_TIMEOUT` | blocker | 启动或停止超时 |
| `RUN_STOPPED_BY_USER` | info | 用户主动停止 |
| `RUNTIME_DEPENDENCY_DISCOVERED` | warning | 实际运行发现静态阶段未见的依赖 |
| `RUNTIME_LOG_TRUNCATED` | warning | 日志达到上限，已截断并注明范围 |

## 9. 后端资格计算顺序

对每个 Bundle、每个后端独立执行：

1. **输入完整性**：若存在 input/bundle/binary `fatal`，所有后端 `ineligible`。
2. **入口确认**：必须获得受验证的相对入口路径。
3. **slice 选择**：主程序和所有强依赖选择同一后端支持架构。
4. **最低系统/API 代际**：比较后端声明能力。
5. **强依赖解析**：Bundle 内依赖、rpath 和后端 Framework 清单。
6. **系统能力**：XPC、驱动、特权 Helper、Metal、硬件和 Apple 服务。
7. **保护策略**：加密、DRM、签名结构、许可确认。
8. **后端 Probe**：安装、版本、健康、显示和权限必须来自实时结果。
9. **风险降级**：只要存在该后端 scope 的 warning 且无 blocker，结果通常为 `experimental`。
10. **实际启动**：只有用户发起后才产生 run 状态；以前一次成功不能替代本次 Probe。

同一应用可得到不同结果，例如：

```json
{
  "bundleId": "com.example.Editor",
  "analysisStatus": "analyzed",
  "plans": [
    {
      "backendId": "darling-wsl",
      "eligibility": "ineligible",
      "blockers": ["CPU_ARM64_ONLY"]
    },
    {
      "backendId": "remote-mac",
      "eligibility": "eligible",
      "selectedArchitecture": "arm64"
    }
  ]
}
```

## 10. 后端版本与结论失效

兼容性结论必须绑定：

- MVM 版本；
- 分析器规则版本；
- 原始输入 SHA-256；
- Bundle 主程序和嵌套代码哈希；
- 后端 ID、版本和 capability manifest 哈希；
- Probe 时间与主机信息的非敏感摘要。

以下变化会使计划变为 `stale` 并要求重新评估：

- 输入或 Bundle 内容改变；
- Runtime Pack、Darling、WSL 或 Remote Mac 系统更新；
- 后端能力清单变化；
- 用户权限、共享目录或安全策略变化；
- MVM 兼容性规则升级。

历史运行结果保留为历史事实，但不自动变成新版本的兼容保证。

## 11. 技术预览测试矩阵

首代测试集必须使用可公开追溯的 fixture，不使用虚构兼容率：

### 解析 fixture

- thin x86_64、arm64、arm64e；
- universal x86_64+arm64；
- load command 截断、重叠和越界；
- XML/binary plist；
- 缺少 Info.plist 或入口；
- 签名存在、缺失、损坏和 `cryptid != 0`；
- HFS+/APFS DMG；
- flat/旧式 PKG；
- 路径穿越、链接逃逸、大小写冲突和 archive bomb。

### 后端 fixture

- 未安装 WSL；
- 只有 WSL1；
- WSL2 无 WSLg；
- WSL2 有 WSLg但无 Darling；
- Darling 健康检查失败；
- x86_64 CLI Hello World；
- 简单 Cocoa 窗口；
- ARM64-only 确定阻断；
- 远程 Mac 不可达、签名验证失败和实际启动成功。

Darling 官方已列出少量已知工作软件，包括 Xcode command-line tools、Python 和 EdenMath；这些条目只能作为上游参考，MVM 仍需在自己的固定 Runtime Pack 上复测。[Darling Known working software](https://docs.darlinghq.org/known-working-software.html)

## 12. 产品文案约束

允许：

- “已完成分析”；
- “存在 x86_64 slice”；
- “Darling 后端可尝试”；
- “进程已启动”；
- “已观察到窗口”；
- “远程 Mac 验证通过”；
- “本次运行退出码为 0”。

禁止：

- 仅凭架构匹配写“原生兼容”；
- 仅凭 `LC_CODE_SIGNATURE` 写“Apple 签名有效”；
- 仅凭进程存在写“应用正常工作”；
- 用演示记录声称真实兼容率；
- 把 WSLg 窗口投射描述为完整 Windows 原生移植；
- 把 Remote Mac 运行描述为本地执行；
- 暗示 MVM、Darling、QEMU 或其他后端获得 Apple 官方认证。

## 13. 许可相关兼容提示

许可提示不替代后端技术诊断：技术上可启动的应用仍可能受来源 EULA 限制。

- MVM 只处理用户自行提供且有权使用的应用。
- 不把 Apple 专有系统文件当作缺失依赖的自动下载项。
- Mac App Store 标准 EULA 对应用的设备使用范围有限制。[Apple Standard EULA](https://www.apple.com/legal/macapps/stdeula/)
- 普通 Windows PC 上的 macOS 虚拟机不是支持后端；macOS Tahoe 26 SLA 将系统与额外虚拟实例限定在 Apple-branded computer。[Apple macOS Tahoe 26 SLA](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)
- Rosetta 不是 MVM 可下载或复用的 CPU 后端；其运行依赖 macOS 内核、系统服务和 Secure Enclave。[Apple Platform Security：Rosetta 2](https://support.apple.com/guide/security/secebb113be1/web)
- QEMU user-mode 没有 Darwin 用户态翻译，因此检测到 QEMU 不会消除 `FRAMEWORK_MISSING` 或 Darwin 系统能力阻断。[QEMU User Mode](https://www.qemu.org/docs/master/user/main.html)

上述边界的目标是让 MVM 技术预览版尽可能多地尝试真实路径，同时保证每一个“可运行”“已启动”和“已验证”都有对应后端与可复核证据。
