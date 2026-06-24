# Repo Cleanup Checklist

本檔記錄 2026-06-24 cleanup pass 中看起來可能過時，但目前 ownership 或 operational value 不夠明確、因此不直接刪除的檔案。

## 刪除前需再次確認

| Path | Current signal | Reason to keep for now | Next check |
|---|---|---|---|
| `.claude/launch.json` | Tracked；未找到 repo-internal references。 | Agent/local launch configuration 可能仍對 handoff 或 development 有用。 | 確認 Claude launch config 是否仍屬於支援中的 operator 或 agent workflow。 |
| `docs/history/TUI-REWRITE-PLAN.md` | Tracked historical document；未找到 repo-internal references。 | 它明確記錄 retired TUI path 與 migration context；刪除可能移除有用的 historical guardrails。 | 決定 `docs/history/` 是否要繼續保留 retired design records，或移到 product repo 外。 |
| `tools/Verify-TorrentOffload.ps1` | Tracked helper；未找到 direct script reference。 | BitTorrent offload 的 manual elevated host validation helper；可能仍需要用於 regression evidence。 | 確認 torrent offload validation 是否已完全由 automated tests 與目前 deployment runbooks 覆蓋。 |

## 保留的本機 Runtime Inputs

除非另有獨立 deployment/runtime maintenance task 明確替換，否則不要在 repo cleanup 中刪除這些檔案：

- `Softwares/**/*.msi`
- `.downloads/software-payloads/`
- `.downloads/deployment-artifacts/`
- `config/osdcloud-secrets.json`
- `config/osdcloud-console.local.json`
- `node_modules/`
