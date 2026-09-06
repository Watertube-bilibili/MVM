# MVM 0.3.0 architecture

MVM is a Windows x64 Electron application with an original experimental compatibility engine.

| Component | Responsibility |
|---|---|
| src/App.tsx, src/viewport.ts, src/styles.css | Responsive library, import/run controls, output, diagnostics and events |
| electron/preload.ts, desktop-api.ts | Narrow typed IPC boundary |
| electron/main.ts | Window lifecycle, IPC validation and Windows NSAlert host dialogs |
| electron/mvm-service.ts | Imports, local state, bounded bundle materialization, run orchestration and events |
| electron/compat-runtime/loader.ts | Guest mappings and explicit system import traps |
| electron/compat-runtime/cpu.ts | x86_64 decoding, cached IR and integer CPU semantics |
| electron/compat-runtime/host.ts | Darwin/libc/Objective-C subset and read-only files |
| electron/compat-runtime/broker.ts, worker.ts | Production worker isolation, active deadline and GUI request/response |
| electron/native-runtime/ | Reused strict Mach-O parser and file bridge; historical tiny interpreter retained for regression tests |
| samples/MVMProbe/, resources/samples/ | First-party C source and compiled macOS default application |
| electron/qemu-runtime.ts | Managed stock QEMU, Ubuntu image download, cloud-init Darling provisioning, SSH transfer and readiness checks; no WSL |
| electron/darling-installer.ts | Historical backend implementation; no installation entry in the shipped UI |

Default flow: input → bounded import → executable snapshot → Worker guest CPU → explicit host API → output/result. A guest NSAlert makes a round trip to the main process; it is not simulated by an unconditional success message.

Archive extraction copies regular bundle resources after preflight. Links and installer scripts are not recreated/executed. The legacy ARCHIVE_STATIC_IMPORT_ONLY identifier is retained for state compatibility but now blocks only the older Darling archive-launch path, not MVM-CPU/2.

The library's persisted launchability reflects legacy diagnostic gates. It is not a universal compatibility verdict. Native execution has its own completed / unsupported / blocked result. completed alone does not certify UI behavior; dialogsShown and output provide separate observations.

See [engine details](NATIVE_RUNTIME.md), [security](SECURITY.md) and [testing](TESTING.md).
