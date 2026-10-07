[English](README.md) | **繁體中文**

<p align="center">
  <img src="screenshots/banner.png" alt="cc-footprint — See and shrink each Claude Code session's footprint" width="100%">
</p>

> **「Context 怎麼這麼快就滿了？才做到一半，又被自動壓縮了！」**
>
> **「多開幾個視窗讓 AI 同時工作，效率飛快 — 但電腦怎麼越來越卡？」**
>
> **「狀態列塞了一堆我用不到的資訊，能不能關掉？」**

讓 cc-footprint 幫你解決這些問題。

每個 Claude Code session 都有自己的 footprint：背著的 **context**，和佔著的 **RAM**。cc-footprint 把這兩樣量出來，放回那個 session 自己的狀態列 — 是什麼在塞 context、是哪個 session 在吃記憶體，看得到，也就降得下來。要看多少由你決定：狀態列只放你勾的，有事才跳提示，想看明細再打開面板。

<p>
  <img src="screenshots/cc-footprint.png" alt="一個 Claude Code session：最下面兩行是狀態列，右側是 /footprint 面板" width="75%">
  <img src="screenshots/tray-menu.png" alt="工具列選單：每個狀態列項目一個開關，分成三組" width="22%">
</p>

*大圖：context 用了 92%，光這一輪就加了 83k token；塞滿它的主要是指令輸出、讀檔和 Claude 自己的輸出。全部 session 共用 1.3 GB，這個 session 佔 310 MB。最下面兩行是狀態列，右側是 `/footprint` 面板。小圖：工具列選單，每個項目一個開關。*

> 支援 Windows、Linux 和 macOS。

## 它告訴你什麼

### Context：多滿、這一步加了多少、是什麼在塞、MCP 佔多少

每一次請求都會把整段 context 重讀一遍。越滿，每一輪越貴、額度燒得越快，也越早被自動壓縮、開始遺失前面的細節。cc-footprint 讓你在它咬人之前就看到：

- **多滿** — `Ctx ▊▊▊▊▊▊▊░░░ 72%`。
- **這一步加了多少** — `↑15k`：這一輪到目前為止塞進 context 的 token，一輪吃掉視窗 5% 以上會變黃。讀完一個檔案、跑完一個指令突然跳一大段，當下就知道是哪一步。
- **是什麼在塞** — `(files 29%)`：最大的來源和它的佔比。來源分成 Claude 的輸出、思考、讀檔、指令輸出、搜尋、網頁、子代理、你的提示、壓縮摘要，以及每一個 MCP server。
- **MCP 佔多少** — 條後面的 `mcp 18%`，條裡也有這麼多格是 MCP 的顏色：視窗裡被 MCP 工具結果佔掉的比例，所有 server 加在一起。瀏覽器操作特別容易把這個數字推高，一頁一頁往上疊。
- **代價** — `5h 34% 2h13m`、`Week 52% 4d21h`：兩個額度用了多少、距離重置多久；也可以顯示 session 累計花費。

Claude Code 內建的 `/context` 也看得到組成，但要你去問它。這裡的數字是這一個 session、即時的，就在你本來就在看的地方。

### RAM：哪個 session 最重

工作管理員裡是一排一模一樣的 `claude`，分不出誰是誰；系統記憶體百分比只告訴你「有東西很重」，不告訴你是哪一個。cc-footprint 把每個 session 對應回它的行程，再把那個行程底下整棵樹加起來：

- **`Claude 310M/1.3G`** — 這個 session／全部 session。一個 session 算的是 claude 行程、它啟動的 MCP server，和工具執行指令用的 shell。
- **`MCP 120M(3)`** — 這個 session 自己的 MCP server 和它們的記憶體。每個 session 都會各自啟動一份本機的 MCP server，記憶體常常就是花在這裡。
- **`+2 outside 240M`** — 黃色：這台機器上不屬於任何 session 的 MCP server——關掉的 session 留下來的，或別的程式的（Chrome 擴充套件的橋接程式、桌面版的 server）。沒有任何 session 在用的記憶體；`/footprint` 會一個個列出來。
- **`Sys 71%`** — 電腦變慢到底是不是記憶體的問題。

## 它怎麼告訴你

三層，由淺到深，資訊量自己決定：

1. **狀態列 — 一直在，只放你勾的。** 工具列圖示（macOS 是選單列）的選單裡每個項目一個開關，即時生效；Linux 沒有圖示，改 `~/.cc-footprint/config.json`。項目多了會依終端機寬度自動折行。
2. **提示 — 有事才出聲。** 單輪把 context 撐大（`Context +45k this turn (5% of the window), mostly file reads`）、快到自動壓縮門檻（85%，讓你自己挑時間 `/compact`）、壓縮完成（`Context compacted: 181k → 9k`）。
3. **`/footprint` 面板 — 想看才開。** 完整的 context 組成（彩色堆疊條＋圖例）、離自動壓縮還有多遠、兩個額度和各自的重置時間、每個執行中 session 的記憶體。開著的時候每 30 秒更新；再輸入一次 `/footprint`，或在空的輸入框按 Esc，就關閉。

提示和面板是一個 Claude Code plugin，安裝程式會一起裝好。Claude Code 的 plugin hooks API 還在早期階段，各版本之間可能變動；目前對著 2.1.289 寫。

## 為什麼要多跑一個背景程式？

因為狀態列自己來不及。Claude Code 每次更新都重跑狀態列腳本（300 ms debounce），新的一次開始時，還沒跑完的那次會被取消 — 太慢就什麼都不顯示。而在 Windows 上，用最直覺的方法查一個 session 的記憶體，遠遠來不及：

| Windows 上的操作 | 耗時 |
|------|------|
| PowerShell 行程查詢 | ~500–900 ms |
| `curl` 打 localhost | ~650 ms（行程啟動開銷） |
| `cat` 透過 pipe | ~230 ms |
| Git Bash 裡一次 `$(...)` subshell | ~30 ms |

所以慢的工作交給一個背景程式：每 60 秒讀一次行程表、加總每個 session 的行程樹、解析對話紀錄算出 context 組成，結果放在 `127.0.0.1:19823`。狀態列腳本只透過 `/dev/tcp` 讀自己那個 session 的快取，約 35 ms，**不啟動任何行程**。Windows 上這個程式是工具列的橘色腳印，macOS 是選單列圖示，Linux 是 systemd 使用者服務。Linux 上它直接讀 `/proc`，macOS 上每分鐘一次 `ps`；狀態列腳本在 macOS 內建的 bash 3.2 也能跑。架構圖在[運作原理](#運作原理)。

## 安裝

**Windows** — 需要 Windows 10/11、Node.js 18+ 和 Git Bash（隨 [Git for Windows](https://git-scm.com/) 安裝）：

```powershell
git clone https://github.com/ilwu/cc-footprint
cd cc-footprint
.\install.ps1
```

**Linux 和 macOS** — 需要 Node.js 18+ 和 bash：

```bash
git clone https://github.com/ilwu/cc-footprint
cd cc-footprint
./install.sh
```

打開 Claude Code session 就能看到狀態列。安裝程式會：

1. 安裝畫圖示用的 npm 依賴（Windows 與 macOS；Linux 沒有圖示，不需要）
2. 複製 statusline 腳本到 `~/.claude/`
3. 把 `settings.json` 的 `statusLine` 指向它 — 原本有自己的會先備份成 `*.bak`；`settings.json` 其他內容和 key 的順序不動
4. 設定登入時自動啟動背景程式：Windows 是啟動捷徑，Linux 是 systemd 使用者服務，macOS 是 launchd agent
5. 啟動背景程式
6. 從這份 clone 安裝 plugin。Claude Code 會依版本另存一份：`git pull` 之後執行 `claude plugin update cc-footprint@cc-footprint` 換成新版，已開著的 session 用 `/reload-plugins` 或重開就會套用。不要的話 `.\install.ps1 -NoPlugin` 或 `./install.sh --no-plugin`
7. 列出可選的全域設定（見[瀏覽器操作交給子代理](#瀏覽器操作交給子代理)）— 只列出，不替你套用

重跑安裝程式是安全的：先停掉執行中的背景程式，更新檔案，再重新啟動。

沒有 clone 的機器只想裝 plugin，在 Claude Code 裡：

```
/plugin marketplace add ilwu/cc-footprint
/plugin install cc-footprint@cc-footprint
```

### 移除

```powershell
.\uninstall.ps1     # Windows
```

```bash
./uninstall.sh      # Linux、macOS
```

會移除開機啟動、本工具的 statusline、`statusLine` 設定和暫存檔、plugin 連同 marketplace 登記和快取副本、有標記的全域設定，以及設定目錄。不是本工具裝的 statusline 不會動；安裝前的設定若有備份，在 `settings.json.bak`。專案資料夾留著，要刪自行處理。

## 然後怎麼降下來

看到數字之後：

| 看到 | 做法 |
|---|---|
| `Ctx` 快滿 | 大改動**之前**先 `/compact` 或開新 session，別做到一半被壓縮 |
| `↑` 跳一大段 | 剛才那步太貴 — 下次一次少讀一點，指令輸出先過濾 |
| 來源是 `think` | 調低 effort（`/effort`） |
| `mcp` 佔比高，或最大來源是某個 MCP server | 把那類工作交給子代理（下面） |
| 某個 session 的 `Claude` 特別重 | 關掉或重開（`claude --resume <id>` 接回）；`outside` 裡關掉的 session 留下的那些，直接在工作管理員結束（`/footprint` 看得出是哪些） |
| 額度快撞上限 | 先做重要的，暫停不急的 session；重置只剩幾分鐘就等一下 |

### 瀏覽器操作交給子代理

在很長的 session 裡用 claude-in-chrome 操作瀏覽器很貴：每次點擊、捲動、讀取都是一次請求，都把整段對話重讀一遍。實測一個 session，72 次瀏覽器請求平均每次重讀 11 萬 token，約佔這些請求費用的 75%；瀏覽器實際回傳的內容只佔約 15%。

這條規則要 Claude 把超過兩三步的瀏覽器任務交給 `browser` 子代理，在它自己很短的 context 裡做完再回報。只有快速看一眼頁面、你想逐步看著操作，或需要你自己在瀏覽器動手（登入、2FA）時，才直接用 Chrome 工具。

這會改到 `~/.claude/` 底下的**全域**設定、影響所有專案，所以安裝程式只列出、不替你做。**套用方式**（兩個檔案都在本專案的 `claude/` 底下）：

1. 把 `claude/agents/browser.md` 複製到 `~/.claude/agents/browser.md`。那裡已經有同名檔案的話，先比對內容再決定。
2. 把 `claude/global-rule.md` 的完整內容（含頭尾的 `<!-- cc-footprint:browser-agent:start/end -->` 標記）貼到 `~/.claude/CLAUDE.md` 最後面，原有內容保留。標記要一起貼，移除程式才找得到並只移除這一段。
3. 重開已經開著的 Claude Code session。

效果看 `Ctx` 後面的 `mcp` 佔比。想換子代理的模型，改 `browser.md` 裡的 `model:`。

**給 AI 助手**：如果是 AI 助手（例如 Claude Code）幫使用者安裝，跑完安裝程式後**先詢問使用者**是否要套用這段，得到同意才做；套用時先讀現有的 `~/.claude/CLAUDE.md` 和 `~/.claude/agents/`，用合併的方式加入，不要覆蓋。安裝程式在 Claude Code 裡執行時，也會在輸出最後印出同樣的指示。

## 參考

### 狀態列項目一覽

| 項目 | 顯示 | 使用情境 | 預設 |
|------|------|----------|------|
| **Context 與用量** | | | |
| Context Window | Context 使用率 % + 進度條 | 快滿時會自動壓縮、前面的細節可能遺失；大改動前先 `/compact` 或開新 session。Context 越長，每次請求也越貴 | 開 |
| Context: Growth This Turn | 接在 `Ctx` 後面的 `↑15k` — 這一輪到目前為止加進 context 的 token（反而變小時是 `↓`；壓縮後重新算起）；單一輪吃掉視窗 5% 以上會變黃 | 當下就看出哪一步很貴，不用等到 90% 才發現 | 開 |
| Context: Top Source | 接在 `Ctx` 後面的 `(files 29%)` — 最大的來源和佔比：`output`（Claude 的回覆和工具呼叫）、`think`、`files`、`shell`、`search`、`web`、`agents`、`prompts`、`summary`（壓縮之後），或某個 MCP server 的名字 | 知道該改什麼，見[然後怎麼降下來](#然後怎麼降下來) | 關 |
| Context: MCP Share | 接在 `Ctx` 後面的 `mcp 18%`，條裡也有這麼多格是 MCP 的顏色 — 視窗裡被 MCP 工具結果佔掉的比例，所有 server 加在一起；還沒用過 MCP 工具時不顯示 | Ctx 漲得很快時，提醒你可能是花太多在瀏覽器操作上。比例高就把瀏覽器工作交給子代理，套用後也用它確認有沒有降 | 開 |
| 5h Usage | 5 小時用量上限 %（訂閱方案；Claude Code 沒提供時自動隱藏） | 快撞到上限前，先把重要的工作做完，暫停不急的 session | 開 |
| Weekly Usage | 7 天用量上限 %（和 5 小時的一樣，沒提供時自動隱藏） | 安排這週剩下的額度；用得太快就把大任務延後，或改用較便宜的模型 | 開 |
| Limit Reset Countdown | 接在 `5h` 和 `Week` 後面，距離額度重置還有多久（`2h13m`、`4d21h`） | 決定要等重置，還是繼續做 | 開 |
| Session Cost | 累計花費（美金） | API 計費時掌握單一任務花了多少；訂閱方案下可用來比較不同做法的成本 | 關 |
| **記憶體** | | | |
| System Memory | 系統記憶體使用率 % + 進度條 | 電腦變慢時，先確認是不是記憶體不夠；快滿了就別再開新 session | 開 |
| Claude Memory | 本 session / 全部 session 總計。一個 session 算整棵行程樹：claude 行程、它的 MCP server、工具用的 shell | 開了好幾個 session，找出最吃記憶體的那個關掉或重開 | 開 |
| MCP Memory | 這個 session 自己的 MCP server：記憶體和個數。後面黃色的 `+N outside` 是這台機器上不屬於任何 session 的 MCP server，關掉的 session 留下的或別的程式的（Chrome 的橋接程式、桌面版） | 看這個 session 有多少是 MCP server 佔的，以及哪些記憶體沒有任何 session 在用；`/footprint` 會一個個列出來 | 開 |
| **Session 資訊** | | | |
| Session ID | 完整 UUID | 之後用 `claude --resume <id>` 接回這個 session，或回報問題時附上 | 開 |
| Project Path | 專案根目錄 | 同時開好幾個視窗時，一眼分辨這個視窗在哪個專案，避免在錯的專案下指令 | 開 |
| Model + Effort | 目前使用的模型和 effort 等級（如 `Opus 5.5 · high`） | 用 `/model` 或 `/effort` 切換過，或不同專案預設不同時，確認現在用的是哪個。Effort 越高，進到 context 的思考內容越多 | 關 |
| Lines +/- | 本 session 新增 / 刪除行數 | Commit 前檢查改動規模是不是比預期大 | 關 |
| Session Duration | Session 已進行時間 | 開很久的 session，context 和記憶體通常也跟著膨脹，是該考慮重開的訊號 | 關 |
| /footprint Hint | plugin 已安裝給你的帳號時顯示 `/footprint`；還沒裝時顯示 `plugin off: rerun the installer for /footprint` | 提醒你面板一個指令就能開，還沒裝的人也知道怎麼取得。只裝在單一專案的 plugin 看不到，那種情況把這項關掉 | 開 |

### 運作原理

```
┌─ 背景程式 (Node.js, 127.0.0.1:19823) ────────────────────────┐
│  每 60 秒：讀一次行程表（Windows CIM / Linux /proc / macOS ps），│
│  把每個 session 的行程樹加起來（MCP server、工具的 shell）     │
│  讀取   ~/.claude/sessions/*.json      (session → PID)        │
│         ~/.claude/projects/**/*.jsonl  (context 組成)         │
│  提供   /session/:id  /context/:id  /sessions  /config        │
│  設定   ~/.cc-footprint/config.json                           │
└───────────────────────────────────────────────────────────────┘
          ▲ /dev/tcp，約 35 ms — 不用 curl、jq，也沒有 subshell
┌─ 狀態列 (bash) ───────────────────────────────────────────────┐
│  每次更新執行，只問自己這個 session 的資料，輸出 ANSI          │
└───────────────────────────────────────────────────────────────┘
          ▲ 同一個 API
┌─ Plugin (Claude Code hooks) ──────────────────────────────────┐
│  每輪結束讀一次 → 提示；/footprint 面板開著每 30 秒讀一次      │
└───────────────────────────────────────────────────────────────┘
```

Claude Code 不會把行程 ID 傳給狀態列，所以 session→行程的對應讀的是 Claude Code 自己寫的 session 檔。MCP server 的判定：命令列有 `mcp`、`modelcontextprotocol` 或 Chrome 橋接程式的 `chrome-native-host` 字樣，且已經跑了 30 秒以上；不在任何 session 行程樹裡的算 `outside`。背景程式不在時，狀態列不顯示它量測的項目，只剩 Claude Code 自己提供的；plugin 仍用 Claude Code 自己的數字回報成長量和壓縮門檻，但沒有記憶體和組成明細。（以前較快的 `wmic`，Windows 11 24H2 起已經移除。）

### 設定

工具列或選單列的選單會寫入 `~/.cc-footprint/config.json`；Linux 上直接編輯這個檔案，改了即時生效（以下為預設值）：

```json
{
  "sys_mem": true, "claude_mem": true, "mcp_mem": true,
  "ctx": true, "ctx_grow": true, "ctx_src": false, "ctx_mcp": true,
  "five_hour": true, "week": true, "resets": true, "cost": false,
  "session_id": true, "path": true, "plugin_hint": true,
  "model": false, "lines": false, "duration": false
}
```

背景程式監聽 `127.0.0.1:19823`。要改連接埠，編輯 `monitor/app.js` 裡的 `PORT`，以及 `statusline/statusline.sh` 和 `plugin/hooks/register.tsx` 裡對應的埠號。

### 疑難排解

**狀態列少了 `Sys`、`Claude` 這些量測項目** — 背景程式沒在跑，或連不上，狀態列只顯示 Claude Code 自己提供的項目。最簡單的是重跑安裝程式，三個平台都會先停掉舊的再啟動；或者手動（項目最多 30 秒就會回來，狀態列每隔這麼久才再問一次）：

- Windows — 右下角應該有橘色腳印圖示（可能縮在工作列 `^` 的溢位區域）。沒有就雙擊 `monitor/start.vbs`；有但項目還是沒回來，先在圖示選單按 Exit 再雙擊。
- Linux — `systemctl --user restart cc-footprint`；看狀態用 `systemctl --user status cc-footprint`。沒有 systemd 使用者 session 的環境，安裝程式會印出手動啟動的指令：`nohup node <clone>/monitor/app.js >/dev/null 2>&1 &`。
- macOS — `launchctl kickstart -k gui/$(id -u)/com.ilwu.cc-footprint`；看狀態用 `launchctl print gui/$(id -u)/com.ilwu.cc-footprint`。

**新開的 session，Claude 記憶體顯示 `-`** — 前幾秒是正常的；背景程式會在下一次顯示時抓到新 session。

**選單列沒有圖示**（macOS）— macOS 版只在 GitHub 的機器上跑過，那裡看不到選單列，所以圖示本身還沒驗證過。背景程式和狀態列不受影響；圖示出現之前，用 `~/.cc-footprint/config.json` 選項目。

## 授權

MIT
