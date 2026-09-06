# MVM 0.3.1 · QEMU workflow fixes

## 中文

此补丁版保留 **QEMU / 自研引擎（不稳定）** 两种运行方式，均不依赖 WSL。

- 修正 QEMU 应用的工作目录：现在先进入应用 Bundle，再执行主程序，确保默认样本能找到相对路径资源。
- 修正取消准备期间仍可能启动虚拟机的竞态；取消会等待当前步骤收尾。
- 写入自动登录配置后重启 LightDM，避免首次启动停在不可密码登录的账户界面。
- Darling 初始化改为可重试的 systemd 服务，临时网络/软件包失败不再使镜像永久停留在半安装状态。
- 升级初始化配置时保留 guest SSH 主机密钥；基础镜像和已有虚拟磁盘不会被删除。

94 项自动化测试通过。自研引擎的包内 Worker 测试运行默认 Mac 程序、读取文件、完成对话框回调并返回 42。QEMU 整机启动、Darling 实际安装和真实 GUI 兼容性仍未完成端到端验证；点击闪烁的目视验收也受桌面工具限制，不能保证所有闪烁成因已消除。

下载 Setup 或 Portable，使用 SHA256SUMS.txt 校验。内置测试应用仍为 MVM Probe 0.3.0，本补丁未改变样本机器码；测试 ZIP 因此仍名为 MVM-Probe-0.3.0.zip。安装前退出旧版 MVM。文件未进行商业代码签名。

[中英使用教程](https://github.com/Watertube-bilibili/MVM#readme) · [QEMU 配置教程](https://github.com/Watertube-bilibili/MVM/blob/main/docs/QEMU.md)

## English

This patch retains **QEMU / original engine (unstable)** selection without WSL.

- Start guest applications from their bundle directory so relative resources resolve.
- Prevent a canceled preparation from spawning QEMU; keep cancellation pending until cleanup finishes.
- Restart LightDM after autologin configuration, including existing guest upgrades.
- Use a marker-guarded, retryable systemd Darling bootstrap service instead of a once-only setup attempt.
- Preserve guest SSH host keys when updating cloud-init configuration; do not delete existing disks.

94 automated tests pass. Packaged original-engine Worker tests run the compiled Mac sample, read its resource, complete a dialog callback and return 42. Full QEMU provisioning, actual Darling installation and GUI compatibility remain unverified. Desktop limitations also prevented visual flicker acceptance.

Verify Setup or Portable against SHA256SUMS.txt. The unchanged sample remains MVM Probe 0.3.0 and its ZIP keeps that version. Exit the old MVM before upgrading. Executables are not commercially signed. This is an experimental compatibility implementation, not a general CrossOver replacement.
