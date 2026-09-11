# 待除錯清單

## [ ] 正式環境首次登入不要自動登入

- 現況：v1.1.0 第一次登入仍會 AutoLogon，讓 post-logon finalizer 執行 software 與 custom script。部署進入 terminal state 後會清除 AutoLogon、Unattend 與 `ProgramData\OSDCloud\secrets.json`；cleanup 失敗不得視為 `windows-desktop-ready`。
- 仍開著：正式環境交機時，第一次登入本身也不應自動登入。
- 原因：現行 finalizer 仍依賴目標使用者的互動桌面。
- 要求：移除首次自動登入後，仍要能證明 software 與 script 的完成機制。
- 邊界：此項不在 v1.1.0 範圍內；不恢復已廢棄的 `v1.0.3-1` manual sign-in。實作前須先確認新的正式環境登入與 finalizer 設計。
