# MVM 0.3.0 compatibility

Compatibility is measured per executable and path, not by a claimed percentage.

| Test target / feature | Current scope |
|---|---|
| Included compiled MVM Probe | Functions, loop, stack locals, read-only resource, selected Objective-C messages and NSAlert bridge; intentional exit 42 |
| Direct .app | Locate and inspect executable, then attempt MVM-CPU/2 |
| ZIP containing a .app | Integrated extraction of regular resources and execution covered by tests |
| DMG / PKG | Container support depends on structure; not a universal installer implementation |
| Intel / Universal Mach-O | Select supported x86_64 LC_MAIN slice |
| ARM64-only | Unsupported execution |
| Foundation / AppKit | Selected first-party NSString / NSAlert bridge only |
| General third-party Mac applications | Not validated |
| Guest libraries, Metal, XPC, DRM | Unsupported |

The new default fixture is compiler-produced, not a hard-coded return-value simulator. The Windows host only creates a dialog when executed guest code requests it. Automated tests inject a dialog callback; this is distinguished from desktop visual checks.

Results:
- completed: guest returned or called a supported exit function within the budget.
- unsupported: missing instruction, import, loader format or runtime method.
- blocked: invalid input, bounds, resource budget or controlled runtime fault.

An import report does not prove application compatibility. A host callback in a unit test does not prove a visible native dialog. A successful Probe result does not prove the compatibility of another application.

Future work should add independently verifiable instruction semantics and real application ABI paths, then test named application versions. Do not mask missing operations with success stubs or fabricate windows/output.
