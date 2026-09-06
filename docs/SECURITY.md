# MVM 0.3.0 security and privacy

MVM automatically attempts execution after import; there is no mandatory human report-review step. Format/path checks and resource limits remain enabled. This is research software, not a malware sandbox. Test only files you are entitled to use, and use an isolated machine for unknown applications.

## Boundaries

- Renderer: contextIsolation, Chromium sandbox, no Node integration, restricted CSP; IPC checks sender window, main frame and origin. Navigation, new windows and unsolicited permissions are denied.
- Imports: extension/magic verification, bounded parsing, archive preflight, path traversal/ADS/reserved-name/conflict checks, size and process-output limits.
- Extraction: fixed bundled 7-Zip files with integrity checks; selected bundle regular resources are copied with exclusive creation and containment checks. No symlink/hardlink creation or PKG script execution.
- Guest CPU: addresses are checked guest-buffer offsets, not host pointers. Explicit memory permissions and instruction/cache/deadline limits apply. No native executable memory or raw host syscall forwarding.
- Files: read-only bundle root, rejected absolute/UNC/device/ADS/traversal paths, realpath containment and stable bounded reads. /mvm/shared/ is a virtual prefix for the bundle, not a whole-drive mount.
- GUI: only explicit supported NSAlert requests reach the main process, with bounded strings/buttons and count.
- Worker: separate V8 isolate protects UI responsiveness. This is not a separate security principal or OS sandbox; engine/parser/Node vulnerabilities remain a risk.

## Limits

Executable 64 MiB; total guest memory 128 MiB; heap 16 MiB; default stack 1 MiB; default 1 million instructions; 100,000 translated instructions; production active deadline 30 seconds excluding user dialogs. Output 256 KiB; file reads 8 MiB each / 32 MiB total; up to 8 dialogs. See [runtime](NATIVE_RUNTIME.md).

Managed resource extraction is limited to 2,048 additional files, 512 MiB total and 64 MiB per additional resource, in addition to archive-level preflight quotas. Archive contents may still expose bugs in 7-Zip or metadata parsers.

## Data and optional features

Library records, managed imports, fixtures and events are stored in the Windows user's MVM data directory. Removing a library record does not remove the user's original input; MVM-owned copies may be removed. Exported reports/events can contain local paths, app metadata and snippets of program output: review them before sharing.

The default runtime has no dependency on WSL/Darling, no telemetry pipeline and no need to upload application files. Historical Darling installer code remains for regression coverage, but its UI entry is removed and normal runtime probing does not call WSL.

No Apple SDK, system Framework, Rosetta or DRM bypass is distributed. Open-source desktop and archive dependencies are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Release binaries are not commercially signed.

## Optional QEMU runtime

QEMU setup explicitly downloads Ubuntu and installs Linux software inside a managed guest. It uses a sparse disk overlay, stock TCG, a localhost cloud-init seed service, localhost SSH forwarding and dedicated key files. Image checksums come from Canonical over HTTPS; Darling uses a pinned archive hash. The Linux guest has network access. Host-to-guest app transfers use bounded read-only snapshots rather than whole-drive mounts. QEMU and SSH are external prerequisites. This pathway is not yet end-to-end verified; see [QEMU](QEMU.md).
