# MVM

MVM 0.3.0 — an experimental macOS compatibility engine for Windows x64.

[简体中文](#简体中文) · [English](#english) · [Download v0.3.0](https://github.com/Watertube-bilibili/MVM/releases/tag/v0.3.0)

## 简体中文

MVM 的目标是在 Windows 上拖入 Mac 应用并运行。0.3.0 默认使用自研 **MVM-CPU/2**：读取 Mach-O，将支持的 x86_64 指令解码为缓存的中间指令，解释执行，并将部分 Darwin / Objective-C 接口桥接到 Windows。运行不需要 WSL、Darling、Linux 虚拟机或管理员权限。

本版不再只执行手写的“返回 42”字节样本。内置 **MVM Probe** 是从仓库中的 C 源码编译出的 macOS x86_64 可执行文件，会执行循环和函数调用、读取 Windows 磁盘上的应用资源，并通过 NSAlert 接口请求一个 Windows 对话框。点击 Continue 后，程序输出完成信息并返回约定的测试退出码 42。

这是有限接口的兼容性原型，不是已经达到 CrossOver 的通用兼容产品，也不是原生机器码 JIT。尚未验证第三方 Mac 应用；普通 Cocoa 应用通常会遇到未实现的动态加载、类、方法或指令。程序结果会显示具体停止原因，不能把“已导入”当成“已兼容”。

### 下载和安装

到 [v0.3.0 发布页](https://github.com/Watertube-bilibili/MVM/releases/tag/v0.3.0) 下载：

| 文件 | 用途 |
|---|---|
| MVM-Setup-0.3.0.exe | Windows x64 按用户安装程序，可选择安装目录 |
| MVM-Portable-0.3.0.exe | 无需安装的便携启动程序；应用数据仍保存在用户数据目录 |
| MVM-Probe-0.3.0.zip | 可拖入 MVM 的同款测试应用及资源 |
| SHA256SUMS.txt | 上述文件的校验值 |

发布包未进行商业代码签名。请确认下载来源，并用 PowerShell 的 `Get-FileHash .\MVM-Setup-0.3.0.exe -Algorithm SHA256` 与发布页校验文件核对。不要运行来源不明的安装包。

### 选择运行方式

主界面提供 **QEMU** 和 **自研引擎（不稳定）** 两个选项。自研引擎默认选中，可立即测试；QEMU 路线使用独立 Ubuntu + Darling，无需自备镜像，但需要先安装标准 QEMU。首次配置会下载系统并安装 guest 软件，整机路径尚未在开发电脑验证。详见 [QEMU 配置教程](docs/QEMU.md)。

### 第一次使用

1. 启动 MVM，点击空页面的“加载默认测试应用”，或应用库旁的立方体按钮“创建默认测试应用”。
2. MVM 自动导入并运行 MVM Probe，不需要安装 Darling，也不需要先查看检测报告。
3. 等待标题为 **MVM Probe - macOS application on Windows** 的对话框。正文来自应用目录内的 `Contents/Resources/message.txt`。
4. 点击 **Continue**。主页面“程序输出”会显示文件内容、`NSAlert host bridge completed.`、执行指令数和退出码 **42**。42 是本测试的成功约定，不是安装失败。
5. 以后选中应用，点击“运行应用”可再次运行；窗口未关闭前，当前运行会等待它。
6. 也可以把发布页的测试 ZIP 拖入 MVM，验证“解包 → 资源读取 → 运行 → 对话框”的完整流程。

旧版已保存的结构样本不会自动被改写。升级后请重新创建默认测试应用，避免继续运行旧版的无窗口样本。

### 导入其他应用和共享文件

拖入 ZIP、DMG、PKG，或用文件夹入口选择已展开的 `.app`。MVM 找到 Bundle 后自动尝试运行，不设置人工审核步骤；仍保留格式、路径和资源上限检查。ZIP 是当前端到端验证过的分发格式。DMG / PKG 能否展开取决于容器结构；不会执行安装脚本，不保证所有安装包都可导入。

默认文件桥只允许读取当前应用 Bundle 内的普通文件。应用的相对路径与虚拟前缀 `/mvm/shared/` 都映射到这个 Windows 目录；例如 `/mvm/shared/Contents/Resources/message.txt`。它不是整个 C 盘的共享，也不支持 guest 写文件。可用“更多应用操作 → 在资源管理器中显示来源”找到来源；修改直接导入的 Bundle 后重新导入，以更新快照记录。

不支持 Apple Silicon-only 应用、完整 Objective-C 类加载、任意 Cocoa 窗口、Metal、XPC、第三方 dylib、加密/DRM 应用或应用安装脚本。遇到未支持项时，可以导出报告和事件，提交 [Issue](https://github.com/Watertube-bilibili/MVM/issues/new)，附上应用版本与错误码；不要上传私人数据或未经许可的商业应用。

### 窗口适配与闪烁修复

内容区支持 360px 起的六档实时布局，标题栏显示宽高、布局档位与缩放比例；窄窗口将诊断侧栏收为抽屉。0.3.0 去掉了应用卡片和工位的点击位移、加载区的循环扫光；相同尺寸不再触发状态更新，拖放使用嵌套计数避免高亮反复切换。尺寸数值采用与 CSS 一致的视口测量。

主界面已移除 Darling/WSL 安装入口，运行能力探测不再调用 WSL。仓库保留旧版后端代码用于历史回归，它不是运行依赖。

### 从源码构建

Windows x64，Node.js 24+，npm 11+：

```powershell
git clone https://github.com/Watertube-bilibili/MVM.git
cd MVM
npm ci
npm test
npm run build
npm run dev
# 生成安装版与便携版，输出至 release/
npm run dist
```

编译好的自有测试应用已放在 `resources/samples/`，普通构建无需 Mac 或 Zig。要重编译样本，下载官方 [Zig 0.15.2](https://ziglang.org/download/)，然后运行：

```powershell
npm run build:sample -- C:\Tools\zig\zig.exe
npm test
```

引擎代码在 `electron/compat-runtime/`；样本源码及自有 ABI 链接声明在 `samples/MVMProbe/`。不分发 Apple SDK、系统 Framework 或 Darling 代码。桌面壳和构建工具仍使用 Electron、React、7-Zip 等开源组件，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## English

MVM aims to run Mac applications on Windows by dragging in an application package. Version 0.3.0 uses the original **MVM-CPU/2** engine: Mach-O loading, cached x86_64 instruction decoding, bounded IR interpretation, and a small Darwin / Objective-C host bridge. The default runtime needs no WSL, Darling, Linux VM, or administrator access.

The included **MVM Probe** is compiled from C into a real macOS x86_64 executable. It runs functions and a loop, reads a resource from the Windows filesystem, and calls NSAlert through the host bridge. Continue closes the Windows dialog; the guest prints its completion message and returns the intentional test exit code **42**.

This is an experimental compatibility implementation, not a general CrossOver replacement or a native-code JIT. No third-party Mac application is certified compatible. Most full Cocoa apps need APIs and loader features that are not implemented.

### Runtime selection

Choose **QEMU** or **自研引擎（不稳定）** (original engine, unstable). The original engine is the default and can run the included test immediately. QEMU uses a managed Ubuntu + Darling guest, with automatic image download; standard Windows QEMU must be installed first. Full guest provisioning is not yet validated on the development machine. See [QEMU setup](docs/QEMU.md).

### Install and run

1. Open the [v0.3.0 release](https://github.com/Watertube-bilibili/MVM/releases/tag/v0.3.0). Download Setup for per-user installation, or Portable to run without installation. Verify the download against SHA256SUMS.txt. The executables are not commercially code-signed.
2. Launch MVM and choose **加载默认测试应用** (Load default test app), or the cube button beside the library.
3. The app imports and starts automatically. Wait for **MVM Probe - macOS application on Windows**, then select **Continue**.
4. Check **程序输出** (Program output) for the resource text, **NSAlert host bridge completed.**, and exit code **42**.
5. Select **运行应用** (Run application) to repeat. You can also drag in MVM-Probe-0.3.0.zip from the release.
6. After upgrading, create a new default test app: previously saved byte-only fixtures are not silently replaced.

### Packages, files and limitations

ZIP and direct .app imports are covered by integration tests. DMG and PKG import depends on their container structure. Install scripts are never executed; extraction does not imply compatibility. The default flow immediately attempts execution after bounded format/path validation, without a manual report approval step.

Guest file access is read-only and restricted to the current .app directory. Relative paths and `/mvm/shared/` map to that Windows bundle root; they do not expose an entire drive. For direct bundles, reimport after changing their files. Archive imports run a managed extracted copy.

The current bridge implements a small libc subset and selected NSString / NSAlert calls, not the full Foundation or AppKit frameworks. ARM64-only binaries, arbitrary guest dylibs, image initializers, chained fixups, full Objective-C metadata, Metal, XPC, DRM and general Cocoa applications remain unsupported. Unknown operations stop with a structured reason.

Responsive layouts cover six width profiles starting at 360px. This release removes card/tab click displacement and the repeating loading sheen, avoids redundant viewport updates, and stabilizes nested drag highlighting. Darling/WSL installation controls have been removed from the UI, and runtime probing no longer invokes WSL. Historical backend code remains in the repository only.

### Build and contribute

On Windows x64 with Node.js 24+ and npm 11+, run `npm ci`, `npm test`, `npm run build`, then `npm run dev`. Use `npm run dist` for installers in `release/`. The first-party compiled sample is checked in; rebuilding it requires official Zig 0.15.2 and `npm run build:sample -- C:\Tools\zig\zig.exe`.

See [engine details](docs/NATIVE_RUNTIME.md), [architecture](docs/ARCHITECTURE.md), [compatibility](docs/COMPATIBILITY.md), [testing](docs/TESTING.md) and [security](docs/SECURITY.md). Report reproducible unsupported cases with exact versions and errors. Do not submit private files, Apple system binaries, or commercial application packages without redistribution rights.
