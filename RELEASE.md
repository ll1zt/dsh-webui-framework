# 发布

发布前，契约锁、CHANGELOG 和 `WEBUI_CONTRACT_VERSION` 必须已经一致：`package.json` 的 `version`、`package-lock.json` 根上的 `version`、`contract/lock.json` 的 `version`，以及 `src/lib/contract-version.ts` 里的 `WEBUI_CONTRACT_VERSION`，是同一个字符串；CHANGELOG 有对应的 `## <version>`，契约哈希与锁一致。版本没对齐就不要继续。

1. 跑门禁 `npm run gate`，再跑宿主对照 `node scripts/host-compat.ts`。两步都通过才继续。`gate` 含类型检查、lint、测试、构建和 `pack:check`；`host-compat` 核对宿主装配表的行 id 是否仍与本仓库的补丁一致。
2. `npm pack` 打出 tarball，再用 `npm run pack:check` 核对包进去的文件列表：要有入口、契约声明、宿主补丁和 CHANGELOG，不能有 `src/`、`scripts/`、`docs/` 或 `examples/`。
3. 打 tag `v<version>`，与 `package.json` 的 `version` 相同。例如版本 `0.4.0` 的 tag 是 `v0.4.0`。
4. 发布的是这一份 tarball（`npm publish <tarball>`），不是工作区里的另一份目录。

本文只记录维护者手工执行的顺序，仓库里的门禁本身不打 tag，也不发布。
