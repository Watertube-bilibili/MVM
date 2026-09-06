# QEMU + Darling / QEMU 运行方式

MVM 提供两种运行方式：**QEMU**、**自研引擎（不稳定）**。两条路径都不依赖 WSL。QEMU 使用标准 Windows QEMU 的 TCG 软件模拟，未魔改 QEMU；Darling 安装在独立 Ubuntu 24.04 x86_64 虚拟机里。

## 使用方法

1. 在运行方式中选择 QEMU，点击“下载 QEMU”，从 QEMU 官方下载入口取得 Windows 安装程序并安装。QEMU 不包含在 MVM 的约 100 MB 安装包里。
2. 确认 Windows OpenSSH 客户端可用，包括 ssh、scp、ssh-keygen。MVM 不会自动修改 Windows 可选功能。
3. 点击“准备 / 启动虚拟机”，阅读下载和磁盘提示，然后选择安装目录内的 qemu-system-x86_64.exe；同目录需要 qemu-img.exe 及配套固件/DLL。
4. 无需自备镜像。MVM 下载 Canonical 的 Ubuntu 24.04 cloud image（当前约 625 MB），核对同站 HTTPS 发布的 SHA-256，并创建独立 32 GB 稀疏 qcow2 写入层。实际空间按使用增长；请至少预留 10 GB。
5. 首次启动通过 cloud-init 安装 Darling 和轻量 Linux 图形桌面。Darling 归档版本和 SHA-256 固定在源码中。此阶段还会下载数百 MB 软件，使用约 4 GB 内存，TCG 下可能需要 20–60 分钟。可以取消镜像下载；启动后请用“关闭虚拟机”正常关机。
6. 状态只有在 guest 中 darling shell uname -s 返回 Darwin 后才变为就绪。就绪后导入或运行应用，MVM 会传送应用副本并提交给 guest Darling。请在 QEMU 窗口内观察结果。

“已提交”不代表应用功能或窗口已验证。自研引擎的测试退出码 42 也不是 Darling 兼容保证。QEMU/Ubuntu 仅提供 Linux 环境，不会补齐 Darling 自身缺少的 Cocoa、Metal 等能力。

## 文件与日志

- 虚拟机、下载缓存、SSH 密钥和已知主机记录在 MVM 用户数据目录的 qemu/ 下，不放进 GitHub。
- 应用通过有界的只读 Bundle 快照传送；拒绝符号链接，每次最多 512 MiB。它不是整个硬盘的实时挂载。
- guest 应用日志为 /home/mvm/inbox/<任务 ID>/run.log；首次安装日志为 /var/log/mvm-bootstrap.log，Windows 侧启动日志为 qemu/serial.log。
- Linux 初始化以 guest root 安装软件；应用以 guest mvm 用户运行。没有给 mvm 用户 sudo 权限。Windows 不需要 WSL 或 Linux sudo。
- SSH 仅转发到 Windows 127.0.0.1 的临时端口，并使用专用密钥和独立 known_hosts；首次连接使用 OpenSSH accept-new。虚拟机有联网能力，不是严格的恶意软件隔离环境。
- 不要手动删除正在运行的虚拟磁盘。MVM 会在退出前要求正常关闭虚拟机。

## 当前验证范围

QEMU 参数、cloud-init 配置、Darling 哈希检查顺序、路径引用、未就绪时阻止提交均有自动化测试。当前开发电脑没有可用 QEMU，Windows QEMU 下载站连接超时，因此尚未完成虚拟机启动、Darling 安装或第三方 Mac 应用的整机验收。此路线属于未完成端到端验证的技术预览，不能标为稳定后端。

## English

Choose **QEMU** or **自研引擎（不稳定）** (original engine, unstable). Neither uses WSL. The QEMU path uses stock Windows QEMU with TCG, a managed Ubuntu 24.04 x86_64 guest, and Darling installed through cloud-init.

Install Windows QEMU using the Download QEMU link and ensure Windows OpenSSH is available. Select Prepare / Start VM, confirm resource usage, then choose qemu-system-x86_64.exe. No existing Linux image is needed: MVM downloads the official Ubuntu image, verifies its HTTPS-published SHA-256, creates a 32 GB sparse overlay, and provisions Darling plus a lightweight desktop. Expect additional downloads, 4 GB guest RAM, at least 10 GB free disk, and potentially 20–60 minutes for first boot under TCG.

Ready requires a Darwin response from the guest's Darling shell. App submission uploads a bounded bundle copy and starts Darling inside the guest; it does not certify application success. Check the QEMU window and guest logs. Files are copied, not live-mounted from the entire Windows drive. Use Shut down VM before exiting MVM.

The configuration has unit coverage, but full VM provisioning and guest application execution have **not** been validated on the development machine because QEMU was unavailable and the Windows download site timed out. This is not a stable compatibility claim. See the Chinese section for exact log paths and security boundaries.

References: [QEMU Windows downloads](https://www.qemu.org/download/#windows), [QEMU invocation](https://www.qemu.org/docs/master/system/invocation.html), [Ubuntu images](https://cloud-images.ubuntu.com/noble/current/), [cloud-init NoCloud](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html).
