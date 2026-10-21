# Hitmaker Windows installer

The approved deliverable is one Windows x64 setup executable with a wizard,
automatic services, a panel shortcut and a Windows uninstall entry. The existing
Express/EJS UI and MVC boundaries stay intact. Implement in this session and
independently review the final change. The user subsequently authorized a test
branch push and native Windows CI; push to main only after completion and passing
checks. Cross compilation alone does not satisfy that completion gate.

## Evidence and decisions

- MongoDB 7 officially supports Windows 11 / Server 2019 / Server 2022 x64.
- BullMQ requires Redis >= 6.2. Package the community Windows Redis 7.2.8 port;
  document its upstream local-use limitation and include third-party notices.
- Package Node 22.23.3, MongoDB 7.0.45, CloakBrowser's Windows build
  146.0.7680.177.5, WinSW 2.12.0 and Microsoft's VC++ runtime. Downloads occur at
  build time, are SHA-256 pinned, and are never delegated to winget/Chocolatey.
- NSIS can compile the actual Windows executable on Linux/macOS. The installer
  itself works offline. A Windows smoke workflow is separate from cross compilation.
- Application files live in Program Files; persistent state lives in ProgramData.
  Dedicated service names and ports must not adopt or reconfigure other databases.
- Preserve state during upgrades and uninstall. Reject an occupied port, an
  unrelated service, an unsupported OS/CPU or a failed dependency/readiness check.

## Task 1: Reproducible payload and installer build

Create `packaging/windows/` for build-only code. Add a pinned dependency manifest,
allowlisted application staging, SHA-256 download validation/retries, payload
integrity manifest, third-party notices and an NSIS compiler image. Package
Windows binaries, production npm dependencies and no local .env/accounts/logs.

Tests first: file allowlist excludes secrets and rejects symlinks, a corrupted
download is rejected, unsafe output paths are rejected, PE headers have the
expected machine type, and a manifest covers every staged file.

Verify: `node --test test/windowsPayload.test.js`; build the real executable;
inspect/extract it and compare staged file hashes.

## Task 2: Installer lifecycle

Use focused PowerShell helpers for preflight, configuration and WinSW service
lifecycle. Include web, task worker and MR worker, private Mongo/Redis services,
safe data-directory junctions, loopback bindings, persistent Redis configuration,
service ownership checks and readiness checks. Stop owned services before update;
on failure restore the previous version and its service configuration. The NSIS
wizard installs shortcuts/uninstall metadata only after health succeeds.

Tests first: XML escaping/argument quoting and Cygwin paths with spaces/Turkish
characters; service ownership refuses foreign paths; existing configuration is
preserved; invalid roots/ports fail; uninstall removes no persistent files.

Verify PowerShell parser and helper tests; run Windows lifecycle smoke tests
(install, health, restart, upgrade, uninstall, reinstall, occupied port).

## Task 3: Documentation, review and delivery

Update README, package scripts, .gitignore and AGENTS with the packaging boundary.
Document supported Windows versions, data/log locations, default local login,
Redis port provenance and the difference between built and Windows-tested.

Run all existing Node tests, JS syntax checks, `npm run browser:info`, package
integrity checks and an independent reviewer. Deliver the executable and checksum.
If native Windows execution is unavailable, report that limit explicitly and
do not describe cross compilation as a successful Windows installation.

## Review focus

1. Spaces/non-ASCII paths, XML and process quoting.
2. Service ownership and rollback without deleting existing data.
3. Redis persistence and the community port's path conventions.
4. No network, npm, winget or Chocolatey required on the target machine.
5. No .env, accounts, browser profiles, cookies or source debug captures in payload.

## Validation rulings

- Native CI exposed an early installer failure before persistent logging starts;
  capture a temporary startup transcript, OS architecture and destination, and
  include it in CI diagnostics. Do not count arbitrary installer failures as a
  passing occupied-port test.
- Compression benchmark against the same payload: per-file zlib builds in 52 s
  and produces a 286.5 MiB installer; solid LZMA produces about 202 MiB but takes
  several minutes. Use zlib for faster build/install/recovery cycles. Payload
  SHA-256 verification remains mandatory for every file.
- Windows transcript confirmed a 64-bit Windows PowerShell 5.1 process but a
  missing Get-FileHash command. Microsoft documents PS7 module-path inheritance
  through intermediary executables (PowerShell issue 27774). Restrict installer
  module lookup to its native PSHOME/Modules, and use a streaming .NET SHA-256
  helper for payload validation. The existing native smoke test reproduces this
  exact pwsh7 -> NSIS -> WindowsPS5 chain.
- Native setup now passes the occupied-port check and installs all five services,
  but fails runtime readiness. Capture native stdout/stderr explicitly (transcript
  alone misses it), and stage all CI diagnostic files on the same drive before
  upload-artifact, which cannot use a common root across C: and D:.
- Readiness diagnostics confirm MongoDB, Redis, panel authentication, API and both
  workers pass. Windows browser launches, but synthetic setContent waits forever
  for load. Replace that artificial document with actual local panel navigation
  and form login using domcontentloaded, the application's navigation contract.
- Independent incremental review identified that transcript/log-copy failures in
  finally could mask a successful installation. Make diagnostic cleanup best-effort
  and mutex release/disposal unconditional.
- Panel assets previously came from Bootstrap/jQuery CDNs. Bundle the same pinned
  distributions with licenses/provenance, and block external browser requests in
  the native local-panel smoke test. Assert both libraries and app.js load.
- Trace initial-install rollback through a readiness failure: remove owned service
  wrappers as well as the promoted version so the nonempty-directory guard does
  not prevent retry. Native CI forces a missing-browser failure using only its
  synthetic retained data/config, checks rollback, restores config and retries.
- Native panel/browser login and restart/data persistence pass. Upgrade stops at
  the strict data audit because Cygwin rewrites Redis AOF directory DACLs. Use a
  bundled runtime/etc/fstab with documented noacl cygdrive options, preserving
  Windows ACL inheritance. The strict audit stays enabled for every upgrade and
  uninstall. References: https://cygwin.com/cygwin-ug-net/using-filemodes.html and
  https://cygwin.com/cygwin-ug-net/using-specialnames.html.
