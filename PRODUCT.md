# MVM Product

<!-- impeccable:product-schema 1 -->

## Platform

Windows 10/11 x64 桌面应用。界面使用 Web 技术渲染，但产品交付形态是 Electron 原生桌面壳、NSIS 按用户安装包和单文件便携构建，不是托管网站。

## Stack

已决策并落地：

- Electron 43.3.0：Windows 主进程、BrowserWindow、预加载桥、文件对话框和安装包运行时；
- TypeScript 7.0.2：主进程、分析核心与渲染器；
- React 19.2.8 + React DOM 19.2.8：界面组件模型；
- Fluent UI React Components 9.74.5 + Fluent System Icons 2.0.335：Windows 视觉语言与可访问控件；
- Vite 8.2.1：渲染器开发与生产构建；
- Vitest 4.1.10：分析核心和服务集成测试；
- electron-builder 26.15.3：Windows x64 NSIS 与便携版分发；
- plist 5.0.0：XML/binary plist 解析；
- 随包提供的完整 7-Zip 24.09（`7z.exe` + `7z.dll`）：DMG/HFS/APFS/XAR/CPIO/ZIP 等容器的只读列举与目标成员读取；运行时只接受这组随包文件及固定 SHA-256，不回退 PATH/Program Files。

安全壳配置已决策：`contextIsolation`、Chromium sandbox、`webSecurity` 与 CSP 开启；Node integration、webview、权限请求、任意导航/重定向和新窗口关闭；渲染器只能使用窄化、类型化 IPC，主进程同时校验当前窗口、main frame 与精确 `file:`/开发 localhost origin。应用持有单实例锁，本地状态写入串行化。

## Users

首代面向愿意阅读兼容性证据和日志的技术测试者、应用开发者及兼容层研究者。他们希望在 Windows 上检查合法取得的 macOS 应用包，并在具备外部实验后端时进行受控启动尝试。

MVM 0.1 不以“所有 Mac 应用拖入即用”的普通消费者为目标用户，也不提供广泛兼容率承诺。

## Product Purpose

MVM 是 Windows 上的 macOS 应用导入、静态分析和运行后端实验平台。首代产品完成从拖放/选择输入、包安全预检、Bundle 与 Mach-O 分析、结构化发现、应用库管理到报告/事件导出的闭环，并在真实探测到 Darling/WSL 后端时为符合条件的直接 `.app` 提供实验启动入口。

成功标准是：每个结论都有可复核证据，每次阻断都有明确原因，没有后端或只有静态分析时绝不伪装成运行成功。

## Positioning

产品采用四层心智模型：

1. **包**：输入类型、文件魔数、归档安全性和 Bundle 定位；
2. **架构**：Mach-O slice、最低系统版本、加密和签名结构；
3. **Framework**：直接动态库和系统能力依赖；
4. **后端**：本机工具、WSL/Darling 可发现性和真实启动证据。

界面定位是“兼容性实验台”：冷静、工程化、证据优先，强调一条从输入到后端的检查跑道。状态不能只依赖颜色，结构样本与真实应用必须清晰区分。

## Operating Context

- Windows 10/11 x64 桌面环境；主流程支持拖放和等价的文件/文件夹选择入口，只接受本机盘符路径并拒绝 UNC/device/extended-device 路径。
- 输入为 `.dmg`、`.pkg`、`.zip` 文件或直接 `.app` 目录。
- 默认离线；没有账号、云端服务、遥测、自动上传或自动下载。
- 安装版按用户安装，不要求提升权限；便携版无需安装，但两者都使用 Electron `userData` 目录保存本地状态。
- 可选 Darling/WSL 由用户自行准备，MVM 不负责安装、升级或隔离该环境。

## Capabilities and Constraints

### 已实现能力

- 图形化应用库、导入进度、四阶段检测台、发现面板、事件记录和 JSON 导出；
- 本地结构样本生成与端到端真实分析；
- XML/binary Info.plist、thin/fat Mach-O、架构、最低系统版本、动态库/Framework、rpath、加密与代码签名命令识别；
- 直接 `.app` 的 `mvm-bundle-manifest-v1` 全 Bundle SHA-256，覆盖路径、条目类型、长度、文件内容和链接目标；导入与启动前都用两次 manifest 夹住结构分析；
- 固定 SHA-256 校验后的随包 7-Zip 能力探测、归档技术列表和安全预检；
- 归档扩展名/魔数一致性检查、输入变化检测、路径/链接/冲突/配额防护；
- 串行化本地持久化、完整 v1 schema 校验、无效状态隔离并持久化修复、应用记录和最近 200 条事件；
- 失败归档导入回收本次 UUID managed copy；结构样本使用独立 `fixtures/<uuid>` 根；
- 仅在用户点击探测后解析 `wsl --list --verbose`，选择确认 `VERSION 2` 的非 Docker 发行版，并以非登录 `sh -c` 发现 Darling 命令/版本，不进入 Darling shell；
- 用户点击“尝试启动”后才要求 `darling shell uname -s → Darwin`，随后紧邻复核直接 `.app` 并提交 `darling shell open`。

### 直接 `.app` 边界

- 从用户原目录分析，不复制完整 Bundle。导入顺序为 manifest-before → 结构分析 → manifest-after，不一致则拒绝入库。
- 启动顺序为 Darling 用户态健康检查 → manifest-before 并与已保存哈希比对 → 最新结构分析/资格判断 → manifest-after 再次比对 → 创建进程；变化会阻断并要求重新导入。
- 仍不是不可变副本；最后一次 manifest 与 Darling 实际使用路径之间存在窄 TOCTOU 窗口，不构成对本机恶意并发修改的强隔离。
- 可以成为 Darling 实验启动候选，但命令提交不等于窗口出现或功能正常。
- ARM64-only 目标不符合当前 Darling 实验路径。

### 归档边界

- DMG/PKG/ZIP 先复制到本地数据目录，再完整列举和预检。
- 当前只物化一个直接可见 `.app` 的 Info.plist 与主程序，不重建资源树、Framework、链接、权限或完整 Bundle。
- 所有归档导入都标记 `ARCHIVE_STATIC_IMPORT_ONLY` 阻断，不能交给后端。
- 当前不递归展开 PKG Payload 安装语义；只在 Payload 中存在的应用可能无法发现。
- 绝不执行 `preinstall`、`postinstall` 或任何包内安装脚本。

### 不提供的能力

- 不捆绑 Apple 专有 Framework、macOS、Apple SDK、Rosetta、恢复镜像、dyld shared cache 或受限服务；
- 不解密受保护 Mach-O，不绕过 DRM、收据、签名、许可或 Apple 服务认证；
- 不验证 Apple 信任链/notarization，不把签名结构存在写成签名有效；
- 不把 CPU slice 匹配写成 Darwin/Cocoa/Metal/XPC 兼容；
- 不验证 WSLg/X11/窗口转发或复杂图形栈；Darling 最小用户态健康通过不等于 GUI 可用；
- 不创建隔离或一次性 Darling prefix；用户自备的 Darling 环境不是安全沙箱；
- 不提供 macOS 虚拟机或远程 Mac 后端；架构文档中的这些内容属于后续方向，不是 0.1 功能；
- 不宣称广泛兼容、Windows 原生执行或 Apple/Darling/7-Zip 官方认证。

### 数据与清理边界

- Windows 用户数据通常位于 `%APPDATA%\MVM`，保存 `mvm-state.json`、成功归档副本、最小分析 Bundle 和 UUID 隔离的结构样本；失败归档会回收本次 managed copy。
- 从 UI 移除记录不删除原始来源，也不自动清除归档副本。
- 卸载安装版或删除便携版通常保留用户数据；完全清理由用户在确认路径后手工完成。
- 报告可能包含绝对路径、Bundle ID、哈希、工具版本和 WSL 发行版名，分享前应脱敏。

## Brand Commitments

名称已确认：MVM。

语气：直接、可信、工程化、有节制。允许说“已完成静态分析”“识别到 x86_64 slice”“Darling 用户态健康检查通过”“启动命令已发送”；禁止把这些分别改写成“完全兼容”“Apple 签名有效”“GUI 已兼容”“应用已正常运行”。

## Evidence on Hand

- 有确定性本地结构样本，可验证 universal `x86_64 + arm64`、plist、AppKit/Foundation 依赖和静态流水线；样本必须始终标注，不能用作兼容率证据。
- 当前有 4 个测试文件、29 项自动化测试，覆盖 Mach-O、魔数、plist、归档路径、7-Zip 列表、服务级 ZIP 导入、失败 managed copy 回收、全 Bundle manifest、无效状态隔离、UNC 拒绝与 WSL2 列表解析。
- 有当前 Windows 主机的 7-Zip/WSL/Darling 探测结果，但单机探测不能外推到用户环境。
- 目前没有足够的真实第三方应用矩阵、长期稳定性数据、性能数据、复杂 GUI 结果或客户证明。

## Product Principles

1. “可尝试”只表示确认的 WSL2、Darling 命令发现和静态规则允许用户点击；真正执行前仍必须通过 Darling 用户态健康检查和最新 Bundle 复核。
2. 默认静态、默认不执行；未知包内脚本永不运行。
3. 分析、命令提交、进程创建、窗口出现和功能验证是相互独立的结论。
4. 诊断必须可理解、可复现、可导出。
5. 输入格式、CPU 架构、Darwin API 与运行后端保持分层，不混为单一兼容分数。
6. 没有真实证据时保持禁用或阻断，不用演示数据填补结论。
7. 运行未知应用是高风险实验，应在隔离账户/虚拟机和专用后端中进行。
8. 完整性复核降低变化风险，但诚实保留不可变副本缺失与窄 TOCTOU 的边界。

## Accessibility & Inclusion

- 拖放有等价的文件/文件夹选择入口；
- 核心流程可使用键盘完成；
- 状态同时使用文本、图标和结构，不只靠颜色；
- 文本和控件目标满足 WCAG 2.2 AA 对比度意图；
- 动效遵循系统“减少动态效果”设置；
- 简体中文用语避免模糊的“成功”，用具体证据描述当前阶段。
