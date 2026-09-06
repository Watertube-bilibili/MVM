# MVM 0.3.0 testing

On Windows x64 with Node.js 24+ and npm 11+:

```powershell
npm ci
npm test
npm run build
npm run dev
npm run dist
```

No WSL or Darling is required. Build output lives in dist/, dist-electron/ and release/. The compiler-produced sample is checked in; `npm run build:sample -- C:\Tools\zig\zig.exe` rebuilds it with Zig 0.15.2.

## Automated coverage

The suite covers archive parsing/preflight, bundle analysis, service import/state, legacy strict Mach-O/IR regressions, read-only file containment, viewport thresholds, optional installer logic and the new CPU engine.

New engine tests execute the compiled sample with a test dialog callback and real temporary file, verify direct CALL/RET, bounded backward branches, forbidden memory writes, unsupported syscalls, virtual Darwin write/exit, arithmetic flags, register zero extension and high-byte MOVZX/MOVSX behavior. Service tests exercise the compiled sample both directly and from a ZIP with its actual resources.

Source-level service tests bypass the compiled Worker wrapper. Before release, also run compiled MvmService createFixture/runNative and confirm engine MVM-CPU/2, resource text, dialogsShown 1 and exitCode 42. A callback test verifies requests and resumption, not native window pixels.

## Desktop acceptance

1. Launch the newly built MVM. Create the default test application.
2. Verify that a Windows dialog titled MVM Probe - macOS application on Windows appears with resource text and Continue.
3. Select Continue. Check program output and exit 42; repeat from Run application.
4. Drag in the release Probe ZIP and check the same path.
5. Test compact and wide windows; check title dimensions, drawer access, output wrapping and absence of horizontal clipping.
6. Click the app and diagnostic tabs repeatedly. There should be no card movement or repeating loading sheen. Resize around layout boundaries and drag across nested child elements to check highlighting.
7. Test malformed/unsupported inputs: do not show a fabricated success or discard their diagnostic records.

Record visual tests separately from mocked callbacks. If desktop capture/activation is unavailable, report that limitation rather than claiming visual acceptance.

## Release

Run tests, typecheck and build; package Setup and Portable. Include the default app ZIP and SHA256SUMS.txt. Verify packaged resources and licenses. Commit source, tag a prerelease, upload artifacts and confirm remote asset sizes/hashes. Never publish .smoke/ state, credentials, user bundles or proprietary Apple files.

QEMU configuration tests cover loopback forwarding, cloud-init and integrity checks, quoting, and blocked submission before readiness. They do not boot a VM or validate Darling installation; see [QEMU verification status](QEMU.md).
