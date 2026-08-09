# MVM 0.1 安全与隐私说明

## 安全定位

MVM 把所有导入的 `.app`、DMG、PKG 和 ZIP 都视为不受信任输入。一代版本的默认行为是静态检查和报告，而不是执行。只有用户主动点击“尝试启动”、目标是直接导入的 `.app`、静态规则没有阻断、存在 `x86_64` slice，且实时探测到 Darling 时，MVM 才会提交实验启动命令。

“通过预检”只表示当前规则没有发现已知结构问题，不是恶意软件检测、代码签名验证或安全保证。请只分析你有权使用的文件，并在隔离环境中测试未知应用。

## 信任边界

| 边界 | 不受信任内容 | 当前控制 |
|---|---|---|
| 用户输入 → MVM 主进程 | 路径、文件类型、归档字节、plist、Mach-O | 仅本机盘符路径、类型/长度校验、扩展名与魔数匹配、有界解析、失败关闭 |
| 归档 → 7-Zip | 复杂 DMG/HFS/APFS/XAR/CPIO/ZIP 结构 | 只使用固定且校验 SHA-256 的随包 24.09 二进制，不回退系统搜索；先列举后读取、超时/输出限制、归档级配额 |
| 归档成员 → Windows 数据目录 | 路径、链接、文件大小和名称冲突 | 路径穿越/绝对路径/ADS/保留名检查，大小写与 Unicode 冲突检测；只物化两个目标文件 |
| 渲染器 → Electron 主进程 | UI 事件和 IPC 参数 | Chromium 沙箱、上下文隔离、CSP、禁用 Node 集成；IPC 校验主窗口/main frame/origin；拒绝权限、导航、重定向、新窗口和 webview |
| MVM → WSL/Darling | 发行版名称、Bundle 路径、第三方可执行代码 | 用户探测时只发现 `VERSION 2`/Darling 命令；尝试启动时才要求用户态返回 `Darwin`，随后参数化提交固定脚本 |
| 报告 → 外部接收者 | 路径、Bundle 标识、哈希、运行时信息 | 仅在用户选择位置后导出；不自动上传 |

## 导入防护

### 输入获取与类型识别

- 只接受直接 `.app` 目录，或扩展名为 `.dmg`、`.pkg`、`.zip` 的普通文件。
- Windows 上只接受形如 `C:\...` 的本机盘符路径。UNC（`\\server\share`）、设备路径（`\\.\...`）、扩展设备路径（`\\?\...` / `\??\...`）和含 `GLOBALROOT` 的别名在访问文件系统前被拒绝。
- 归档扩展名必须与检测到的文件魔数相符；不因扩展名直接信任内容。
- 单个容器输入上限为 16 GiB。
- 归档输入先复制到 MVM 数据目录。复制前后比较源文件大小和修改时间；变化时中止导入。
- 归档导入在提交状态前失败时，会删除本次 UUID 对应的受管 `imports` 目录；不会把失败输入副本长期留在应用库数据中。
- 直接 `.app` 当前从原位置读取，不建立不可变副本；其完整性流程见下一节。

### 直接 `.app` manifest 与启动前复核

直接 `.app` 的 `sourceSha256` 不再只是 plist 与主程序哈希，而是带域分隔标记的 `mvm-bundle-manifest-v1` 全 Bundle manifest。它以确定顺序遍历最多 100,000 个条目、累计最多 16 GiB，并把以下内容送入 SHA-256：

- NFC 归一化后的相对路径；
- 条目类型（目录、普通文件或符号链接）；
- 普通文件长度与完整文件字节；
- 符号链接目标；链接必须保持在 Bundle 根内；
- 目录结构。大小写折叠后的路径碰撞和不支持的特殊文件类型会被拒绝。

每个文件读取前后都会比较类型、长度、修改时间和文件标识，并核对实际读取字节数。导入顺序为：

```text
manifest-before → Info.plist/Mach-O 结构分析 → manifest-after
```

只有两个 manifest 相同才会入库。用户点击“尝试启动”且 `darling shell uname -s` 返回 `Darwin` 后，启动完整性顺序为：

```text
manifest-before（必须等于已保存 sourceSha256）
→ 重新执行 Info.plist/Mach-O 分析并重新判断 blocker/x86_64
→ manifest-after（必须同时等于 before 和已保存 sourceSha256）
→ 创建 WSL/Darling 进程
```

这能阻断导入后变化和大部分复核期间变化，但源 Bundle 仍不是不可变副本。从最后一次 manifest 完成到操作系统真正创建/读取 Darling 目标之间，仍存在窄小 TOCTOU 窗口。本机有能力并发替换文件的攻击者不能被这套应用层复核视为已隔离。

### 归档预检

MVM 只调用随包提供的完整 7-Zip 24.09，不从 PATH、Program Files 或其他系统位置回退。每个 MVM 进程首次探测随包工具时会同时验证：

- `7z.exe` SHA-256：`e2ca3ec168ae9c0b4115cd4fe220145ea9b2dc4b6fc79d765e91f415b34d00de`；
- `7z.dll` SHA-256：`882063948d675ee41b5ae68db3e84879350ec81cf88d15b9babf2fa08e332863`。

任一文件缺失或哈希不符，归档能力失败关闭。哈希通过后，MVM 才调用它做技术列表并在读取成员前检查全部条目。默认上限包括：

- 最多 250,000 个成员；
- 总声明展开大小最多 32 GiB；
- UTF-8 路径最多 4,096 字节，单个路径组件最多 255 字节；
- Info.plist 最多 32 MiB；
- 主可执行文件最多 512 MiB；
- 列举和目标成员读取各有 120 秒超时及有界输出。

预检拒绝或记录：

- `..` 穿越、绝对路径、Windows 驱动器路径、UNC 路径和反斜杠混淆；
- NUL/控制字符、空组件、NTFS Alternate Data Stream；
- Windows 保留设备名、尾随点/空格、过长名称；
- 重复路径、大小写或 Unicode 归一化后冲突；
- 越出归档虚拟根的符号链接/硬链接；
- 加密成员、异常或不完整的 7-Zip 技术列表、条目数或体积超限。

通过预检后，首代只用 7-Zip 的标准输出读取一个直接可见 `.app` 的 `Contents/Info.plist` 和 `Contents/MacOS/<CFBundleExecutable>`，并写入隔离的导入 ID 目录。它不会按归档路径完整落盘，不创建归档中的链接，也不恢复整个资源树。

### PKG 脚本与安装行为

MVM 不调用 Apple Installer，不解释或执行 `Distribution`、`PackageInfo` 中的脚本，也不执行 `preinstall`、`postinstall` 或 Payload 内的任何程序。当前版本不递归实施 PKG Payload；若 `.app` 没有作为 7-Zip 列表中的直接可见 Bundle 出现，导入会安全失败。

### plist 与 Mach-O

plist 和 Mach-O 解析器对字节长度、偏移、计数、嵌套深度和节点数量做边界检查；损坏或截断结构作为诊断返回，不应让 UI 渲染器获得文件或进程权限。检测到加密 Mach-O slice 时会产生阻断项。存在 `LC_CODE_SIGNATURE` 只能说明签名数据结构存在，不能证明 Apple 信任链、notarization 或 Bundle 资源完整性有效。

## 桌面壳防护

Electron BrowserWindow 当前启用：

- `contextIsolation: true`；
- `sandbox: true`；
- `nodeIntegration: false`；
- `webSecurity: true`；
- `allowRunningInsecureContent: false`；
- `webviewTag: false`。

页面提供显式 CSP：脚本仅允许同源，object/frame/base/form 被禁止；开发模式仅为固定 localhost Vite/WebSocket 连接开口。新窗口、webview 附加、页面导航和重定向被拒绝，默认 session 的权限检查与权限请求统一返回拒绝。

预加载脚本只暴露应用快照、选择输入、导入、探测、导出、移除记录、显示来源和启动等固定方法。每个 IPC 请求必须同时满足：来自当前 MVM `webContents`、来自它的 `mainFrame`，并且打包模式为精确的 `dist/index.html` `file:` URL，或开发模式为经 localhost 校验的精确 origin。主进程还对字符串参数做类型、长度和 NUL 检查。

MVM 使用 Electron 单实例锁，第二次启动只聚焦已有窗口，降低两个进程同时操作同一状态文件的风险。服务内部还用 promise 队列串行化临时文件写入与原子 rename。载入时会对状态容器、应用和事件的必需字段、枚举、数组上限、字符串长度、时间、哈希与本机路径执行完整 v1 schema 校验；无效条目被隔离，顶层损坏时重建空状态，并把修复结果重新持久化。这些措施用于一致性和损坏恢复，不是对具有同一用户文件写权限的攻击者提供加密或访问控制。

这仍不消除 Electron/Chromium、7-Zip 或 Node.js 自身漏洞。发布版应持续更新这些组件、重新运行恶意归档回归测试，并在公开分发前增加代码签名、依赖/SBOM 扫描和漏洞响应流程。

## Darling/WSL 执行风险

Darling/WSL 是可选实验后端，不是安全沙箱。提交一个 `.app` 给 Darling 等同于执行第三方代码。MVM 0.1 直接使用用户已有 Darling 环境，**不会为每次运行创建隔离或一次性 prefix**。Windows 驱动器通常会映射到 WSL；恶意或有漏洞的应用可能读取、修改或外传后端可访问的数据。

MVM 不在应用启动时自动探测 WSL/Darling。只有用户点击“探测运行能力”后，才解析 `wsl --list --verbose`，排除 Docker 发行版并只选择明确报告 `VERSION 2` 的发行版；随后以非登录 `sh -c` 运行 `command -v darling` 与 `darling --version`。探测阶段不进入 Darling shell，状态“可用”只表示命令与版本已发现。

用户点击“尝试启动”后，MVM 才先运行 `darling shell uname -s`；只有成功得到 `Darwin` 才紧邻执行 manifest-before、fresh analysis、manifest-after 和进程创建。这仍没有验证：

- WSLg、X11 或图形栈健康；
- 现有 Darling prefix 干净、一次性或隔离；当前实现明确不创建隔离 prefix；
- Windows 挂载、网络、设备和凭据已受限；
- Darling 的 macOS API 覆盖足以运行目标应用。

建议测试人员：

1. 使用无生产凭据的 Windows 测试账户或虚拟机；
2. 为 MVM 使用专用 WSL 发行版和 Darling prefix；
3. 不把含 SSH 密钥、浏览器配置、源代码或个人文件的目录暴露给后端；
4. 在防火墙/网络隔离下测试未知应用；
5. 观察 WSL 和 Darling 进程，测试后销毁实验环境；
6. 不把“命令已发送”或“进程存在”当作应用功能正常的证明。

MVM 不附带 Darling，不会自动安装、升级或修改 WSL，也不会下载 Apple 文件。

## 数据与隐私

MVM 应用代码未实现遥测、账户系统、云同步、自动崩溃上传、自动更新或远程配置。默认分析链路不需要网络。

Electron 的 `userData` 目录在 Windows 上通常为 `%APPDATA%\MVM`，其中可能包含：

- `mvm-state.json`：应用记录、绝对来源路径、内容哈希、Bundle 元数据、发现和最近事件；
- `imports\<id>\source.*`：DMG/PKG/ZIP 的完整复制品；
- `imports\<id>\*.app\`：归档静态分析所需的最小 plist/主程序副本；
- `fixtures\<uuid>\MVM Probe.app`：每次在独立 UUID 根中生成的测试样本；样本生成后若导入阶段失败，会回收该根。

MVM 最多在状态中保留 200 条事件摘要。报告和事件导出由用户选择目的地，不会自动发送。导出文件可能泄露用户名、本机目录结构、应用 Bundle ID、哈希、WSL 发行版名称和工具版本，分享前应检查与脱敏。

从 UI 移除应用只删除状态记录，不删除用户原始文件，也不删除 `imports` 中的归档副本。安装版卸载和删除便携版通常也保留 `userData`。彻底清理时，退出 MVM，确认 `%APPDATA%\MVM` 的实际路径和内容后再手动删除；该操作不可恢复。

可选后端中启动的第三方应用可能自行访问网络或其可见文件，MVM 无法替它提供隐私保证。

## 已知残余风险

- 7-Zip 是处理复杂不受信任格式的原生解析器；超时和配额只能降低风险，不能证明无内存安全漏洞。
- 直接 `.app` 不是不可变快照。虽然导入与启动都用全 Bundle manifest 双侧夹住结构分析，最后一次 manifest 与 Darling 实际使用路径之间仍有窄 TOCTOU 窗口。
- 失败归档会回收本次受管副本，但成功归档当前没有通用垃圾回收；敏感包仍可能在移除记录或卸载后残留。
- Windows 与 HFS+/APFS 的权限、符号链接、大小写和 Unicode 语义不同；静态副本不等价于原始 Bundle。
- 当前没有恶意软件扫描、证书吊销检查、Apple notarization 验证或可信发布者策略。
- 当前发布构建未代码签名，不能通过发布者证书证明安装包来源。
- WSL/Darling 的进程启动是外部边界；MVM 0.1 不创建隔离 prefix，也没有完整的停止、资源配额、网络策略、窗口观察或崩溃证据采集。

因此，MVM 0.1 应只用于研究和早期兼容性测试，不应在装有生产凭据或唯一数据的主机上执行未知应用。
