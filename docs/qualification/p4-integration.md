# P4 integration preview

Base: P3 `cb4daf95b58b8168bc9709cc5311da8f5cc0c214`.
Merged: P2 `80efdc5fa2be6feff7dd48e151c834a7a90290df` with `git merge --no-ff qualification/p2`.

## Conflicts and retained behavior

Git reported **no conflicts** (ort auto-merged the runtime); no manual conflict resolutions were necessary. The anticipated documentation conflict did not occur: P2 and P3 qualification reports are separate files. Neither report was removed or rewritten.

The runtime retains P2-F2 `parseWorkerCompletion`: malformed injected completions become uncertain, do not report and are not retried. It also retains P3-F3 `ReportDeliveryReceipt.kind: 'hook-boundary'`, explicitly not provider-input proof. Both suites remain in the routed tests; no test was dropped.

## Executed integration checks

- `bun install --frozen-lockfile`: exit 0, Bun 1.3.14, 256 packages installed.
- `bun run test`: **463 pass, 0 fail, 2801 expect() calls, 39 files**.
- `bunx tsc -p packages/core/tsconfig.json`: exit 0.
- `bunx tsc -p hosts/pi/tsconfig.json`: exit 0.
- `bunx tsc -p examples/p1/tsconfig.json`: exit 0.
- `bunx tsc -p hosts/pi/test/tsconfig.json`: exit 0.

The count is exactly the expected union: 406 + 301 - 244 = 463. This is a finite mechanical integration preview, not live use or semantic acceptance.
