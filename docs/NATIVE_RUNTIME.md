# MVM-CPU/2 — Windows compatibility engine

Version 0.3.0 supersedes the byte-only MVM-IR/1 experiment. The old `electron/native-runtime/` parser, file bridge and tests remain reusable infrastructure; the active engine is in `electron/compat-runtime/`.

## Execution

1. Import locates the executable named by Info.plist. Direct bundles use their Windows directory; archives produce a managed bundle with bounded regular resources.
2. A stable, bounded read takes the executable snapshot. The strict Mach-O parser selects an x86_64 thin/fat slice with MH_EXECUTE and LC_MAIN.
3. The loader maps segments at their preferred guest addresses, including zero-filled data. Guest pointers are BigInt values into checked buffers, never native process pointers.
4. Classic indirect symbol tables, stubs, GOT pointers and supported dyld binding opcodes resolve to explicit host-call traps. Only recognized system-library names are admitted. This is a flattened host symbol bridge, not a complete two-level dyld namespace.
5. Reached x86_64 instructions decode once into cached IR. The CPU executes branches, calls, returns, stack/local variables, integer arithmetic, comparisons and supported memory operands.
6. Darwin/libSystem calls access the bounded file/output/heap bridge. Selected Objective-C messages construct virtual NSString / NSAlert objects.
7. An NSAlert request travels from the Worker to the Electron main process. Only the main process invokes the Windows message dialog. Its response resumes the guest.
8. Execution returns output, instruction counts, host-call trace, dialog count and exit status, or the exact unsupported/fault reason.

The production CPU runs in a dedicated Worker V8 isolate. Source-level Vitest service tests use the direct entry; compiled-worker integration must also be checked. Neither mode uses WSL, a Linux VM, native executable-memory allocation, eval, or raw Windows syscalls.

## Implemented subset

- Integer registers and REX; supported 8/16/32/64-bit register, ModRM/SIB and RIP-relative operands.
- MOV, selected sign/zero extensions, LEA, integer arithmetic/logical operations, comparisons, shifts, multiplication/division, condition flags, conditional branches/set/move, direct and indirect CALL/JMP, PUSH/POP/LEAVE/RET.
- Virtual Darwin exit/read/write/open/close syscall numbers. No raw guest syscall is forwarded to the host.
- Imported puts, write, read, open, close, strlen, strcmp/strncmp, malloc/calloc/free, memcpy/memmove/memset, exit/_exit.
- objc_getClass, sel_registerName, objc_msgSend, minimal autorelease-pool entry points, NSApplicationLoad.
- Limited NSString construction/UTF8String and NSAlert allocation, message/detail/buttons/runModal. These are independent host implementations, not copied Apple frameworks.

ABI support is deliberately incomplete. Allocations use a bounded arena; free does not reclaim it. errno, full reference counting, arbitrary selectors and binary Objective-C class metadata are not implemented. strncmp currently expects NUL-terminated strings. NSApplicationLoad initializes only the supported bridge; it does not create a full Cocoa application.

## Budgets and boundaries

| Resource | Default / maximum |
|---|---|
| Executable snapshot | 64 MiB |
| Guest mappings combined | 128 MiB including heap and stack |
| Guest heap | 16 MiB arena |
| Stack | 1 MiB default; 16 MiB maximum |
| Instructions | 1,000,000 default; 10,000,000 maximum |
| Unique decoded instructions | 100,000 |
| Production active runtime | 30 seconds total; user dialog waiting excluded |
| Captured output | 256 KiB combined |
| Host trace | First 2,048 calls |
| Read-only file bridge | 8 MiB per file, 32 MiB total, 64 descriptors |
| Dialogs | 8 per run, at most 8 buttons each |

The Worker is a responsiveness and resource boundary, not an OS security sandbox. V8 heap limits do not independently bound every native Buffer allocation; explicit guest mapping limits are also enforced.

## Not implemented

ARM64 execution, SIMD/x87, threading/atomics, arbitrary guest dynamic libraries, complete relocation/rebase semantics, dyld chained fixups, weak bindings, image initializers/finalizers, encrypted images, full Objective-C/Cocoa, Metal, CoreAudio, XPC, application services, unrestricted host filesystem access and guest writes.

Unknown loaded libraries, unsupported initializer sections and unsupported fixup formats stop explicitly. Preferred-address loading avoids an ASLR slide; it is not a general dyld implementation.

## Reproducible default application

`samples/MVMProbe/main.c` is compiled by official Zig 0.15.2 / Clang targeting x86_64-macos at -O0. The two .tbd files are first-party public ABI link declarations for objc and AppKit. No Apple SDK/framework binaries are supplied. Compiler tooling is not bundled in MVM.

Run `npm run build:sample -- C:\Tools\zig\zig.exe`. The script checks the compiler version and copies the sample metadata and message resource. The published binary is `resources/samples/MVMProbe`.

The program sums 1 through 10, reads Contents/Resources/message.txt, constructs an NSAlert, waits for its response, prints completion and returns 42. The Windows tests prove this explicit path, not arbitrary applications or full macOS behavioral equivalence.

The official Windows compiler archive used during development has SHA-256:
`3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c`.

References: [Zig downloads](https://ziglang.org/download/), [LLVM TAPI implementation](https://www.llvm.org/docs/doxygen/TextStub_8cpp_source.html).
