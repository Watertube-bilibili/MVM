# MVM 0.3.0 · MVM-CPU/2 technical preview

## 中文

新增运行方式选择：QEMU / 自研引擎（不稳定）。QEMU 路线提供 Ubuntu 镜像下载、cloud-init Darling 初始化和应用传送，需先安装标准 QEMU；整机启动与安装尚未验证。详见 [QEMU 教程](https://github.com/Watertube-bilibili/MVM/blob/main/docs/QEMU.md)。

- 默认运行路径升级为自研 MVM-CPU/2，不依赖 WSL、Darling 或 Linux VM；已移除 Darling/WSL 安装入口和自动探测。
- 内置 MVM Probe 改为从 C 编译出的真实 macOS x86_64 程序，覆盖循环、函数调用、资源文件读取和有限 NSAlert 桥接；测试成功退出码为 42。
- ZIP 导入会解包常规应用资源，导入后自动尝试运行；主页面增加程序输出和再次运行入口。
- 修正卡片/工位点击位移、循环扫光、重复尺寸更新和嵌套拖放高亮切换，并保留六档实时响应布局。
- README 提供中英双语安装、使用、文件映射和构建教程。

验证：93 项自动化测试通过；编译后的 Worker 直接运行和 ZIP 导入运行均执行 501 条指令、返回 42，并完成一次测试对话框回调。新版安装包的窗口和入口已通过可访问性树确认，但桌面工具报“coordinate input geometry is unavailable”，未完成实际对话框点击和闪烁的目视验收。回调测试不等于窗口目视验收。

下载 Setup 安装版或 Portable 便携版，配合 SHA256SUMS.txt 校验。升级前请退出旧版 MVM；升级后重新创建默认测试应用，旧版结构样本不会被自动改写。也可拖入 MVM-Probe-0.3.0.zip。

这是有限接口的解释执行兼容原型，不是完整 CrossOver 替代品。未验证第三方 Mac 应用，尚不支持完整 Cocoa、ARM64、任意动态库、Metal 或 DRM。文件桥只读当前应用 Bundle，不共享整个硬盘。发行文件未进行商业代码签名。

## English

Added QEMU / original engine (unstable) selection. QEMU uses a managed Ubuntu image, cloud-init Darling provisioning and app transfer; stock QEMU is a prerequisite. Full VM boot/provisioning remains unverified. See docs/QEMU.md.

- Original MVM-CPU/2 runtime, without WSL, Darling or a Linux VM; removed Linux backend installation controls and automatic WSL probing.
- Compiler-produced macOS x86_64 Probe exercises functions, loops, resource reads and a limited NSAlert host bridge; its intentional success exit code is 42.
- ZIP resource extraction, automatic execution attempts, captured output and a Run application button.
- Removed click displacement and repeating loading sheen; stabilized viewport updates and nested drag highlighting, retaining six responsive width profiles.
- Bilingual README with installation, usage, file mapping and build instructions.

Validation: 93 automated tests passed. Compiled Worker integration passed both direct and ZIP execution: 501 instructions, exit 42, one test dialog callback. The packaged UI's accessibility tree was inspected, but desktop input failed with “coordinate input geometry is unavailable”; actual dialog clicking and visual flicker acceptance were not completed. Callback tests are not visual acceptance.

Download Setup or Portable and verify SHA256SUMS.txt. Exit the old MVM before upgrading. Create a fresh default app after upgrading, or import MVM-Probe-0.3.0.zip; old byte-only fixtures are not silently replaced.

This is a bounded IR interpreter and limited API bridge, not a full CrossOver replacement or native-code JIT. No third-party app is certified compatible. Full Cocoa, ARM64 execution, arbitrary guest libraries, Metal and DRM are unsupported. Guest files are read-only within the application bundle. Executables are not commercially code-signed.
