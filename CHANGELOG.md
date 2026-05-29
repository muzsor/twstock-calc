# 變更紀錄

本專案採用 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式;版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [1.3.1] — 2026-05-29

### Changed
- **拆分主腳本為獨立檔案** `app.js`：`<script>` 區塊從 `index.html` 抽出(~76 KB / ~1714 行)，改用 `<script defer src="app.js?v=1.3.1"></script>` 引用，並放置於 `<head>` 利用 defer 讓 JS 與 HTML parsing 平行下載。
  - `index.html` 從 2318 行縮減至 602 行，純粹只剩結構與最小必要的 FOUC 防止 script。
  - 沿用 v1.2.1 拆 CSS 的同一條思路：HTML/CSS/JS 三層職責完全分離。
  - 改主邏輯不必動 HTML，小幅 UI 微調不必動 JS，diff 更乾淨。
  - 首次載入多一個同源 HTTP/2 請求(~30–50 ms)，之後 SW 已快取就沒差別。
  - 編輯器與 IDE 終於能對 `.js` 做完整的 lint / format / autocomplete(原本 inline 在 HTML 內的 JS 工具支援度不一)。
- **`<head>` 內 FOUC 防止 script 仍保留 inline**：這段要在 CSS 解析前同步執行(設定 `data-theme` / `data-app-mode`)，搬到外部 defer 就擋不住 FOUC 了。
- `sw.js` `ASSETS` precache 清單加入 `./app.js`，離線冷啟動仍能完整載入。
- `APP_VERSION` 從 `index.html` 移到 `app.js`;改版時需同步更新 `index.html` 內兩處 `?v=` query(styles.css 與 app.js)。

## [1.3.0] — 2026-05-28

### Added
- **除權息試算模式**：頂部加上模式切換鈕「交易試算 / 除權息試算」，兩個 layout 用 `:root[data-app-mode]` CSS 屬性切換顯示;初始模式由 `<head>` 內的早期 inline script 設定，避免切換時 layout 閃一下。兩種模式各自獨立持久化(`twStockCalc.dividend.v1` / `twStockCalc.appMode`)，設定不互相污染。
- **除權息計算左卡**：除權息前股價、現金股利、股票股利、持股(獨立張/股單位);齒輪 popover 收納進階設定(二代健保補充保費率 / 起徵點 / 股利以外綜合所得淨額)。
- **除權息試算結果右卡**(6 個區塊)：
  - 除權息參考價 + 股價蒸發
  - 現金股利收入 + 二代健保補充保費(單筆 ≥ 起徵點才扣)+ 實領
  - 配股後總股數 + 整股/畸零股拆解(畸零股顯示小數)
  - 填權息所需漲幅 + 目標價
  - 現金/股票/合計殖利率
  - 股利所得稅試算：**合併課稅(8.5% 抵減，上限 8 萬)vs 分離課稅(28%)**，自動比較並標示推薦方案;以累進稅率精算「股利造成的額外稅」(支援退稅情境，負值顯示)
- **7 個新純函數**暴露於 `window.__calc`：`calcExDividendPrice` / `calcCashDividendIncome` / `calcStockDividendShares` / `calcFillDividendGain` / `calcDividendYield` / `calcProgressiveTax` / `calcDividendTax`
- **單元測試 +45 個**(133 → 178)：覆蓋 7 個函數的基本案例、邊界(0 股利、0 股價、負值 clamp)、台灣綜所稅累進級距(2024 年度)、補充保費門檻、高低所得 A/B 方案比較。

### Changed
- **reset / copy 按鈕變 mode-aware**：除權息模式下重置清除 dividend storage、複製產生對應的 dividend report。
- **行動底部 sticky 結果列**在除權息模式下自動隱藏(該欄不適用)，body padding 同步取消預留。
- **footer 免責聲明**拆為交易/除權息兩段，按當前模式顯示對應警語(健保費率、綜所稅級距、畸零股換現金等)。

### Refactored
- 沿用既有 `.theme-toggle` 樣式邏輯但放大成 `.mode-toggle`(15px 字 / 22px padding，iOS pill 視覺)，作為更主要的頂層導航。
- **頂部控制區重組為一行兩端對齊**：mode 切換靠左、theme + 重置 + 複製靠右，省下原本獨佔的 `.mode-bar` 一列;`.btn-action` 改 `inline-flex` 並加 SVG 圖示(重置：循環箭頭;複製：重疊矩形)，保留文字標籤。mobile 上自動 wrap 成兩排並置中。
- **模式 active 強化辨識**：active 按鈕改用主藍色字 + 內縮 3px 藍色底線 indicator(`::after`)，配合原本的浮起卡片背景，遠距離一眼可辨;與 result-card tab「下線 + 重字」的視覺語言呼應。
- **主題切換改為單一循環圖示按鈕**：原本 3 段式 segmented pill(跟隨/淺/深 + 色點)改為 36×36 icon button，點擊循環 `auto → light → dark`，圖示依當前狀態切換(Feather monitor / sun / moon)，hover 與 aria-label 顯示當前主題;節省約 130px 寬度，讓 mode 切換在頂部更顯眼。

## [1.2.1] — 2026-05-28

### Changed
- **拆分樣式為獨立檔案** `styles.css`：`<style>` 區塊從 `index.html` 抽出(~32 KB / ~1200 行)，改用 `<link rel="stylesheet" href="styles.css?v=1.2.1">` 引用。
  - `index.html` 從 109 KB / 2823 行縮減至 76 KB / 1621 行，可讀性與維護性提升。
  - 首次載入多一個同源 HTTP/2 請求(~50ms)，GZip 後傳輸量幾乎不變。
  - 改 CSS 不需動 HTML，小幅改樣式時 diff 更清晰。
- `sw.js` `ASSETS` precache 清單加入 `./styles.css`，離線時冷啟動仍能正確套用樣式。
- 保留 `<head>` 內 theme init `<script>`(在 `<link>` 前)避免 FOUC。

## [1.2.0] — 2026-05-27

### Added
- **多筆加碼買進**：交易條件改為「買進列表」，支援 1~10 筆加碼，每筆獨立 price/qty，共用全域設定(折扣、商品類型、最低手續費、單位)。
  - 加權平均成本顯示在列表下方(≥2 筆才顯示)
  - 損益兩平計算採加權平均(沿用既有公式，以 aggregated `totalCost` / `totalShares` 餵入)
  - 第 1 筆不能刪除，第 2 筆以後皆可刪;達 10 筆時「+ 加碼買進」隱藏
- **`calcMultiBuy(entries, sharesPerUnit, discount, minFee, taxRate)` 純函數**：每筆獨立適用最低手續費(券商每筆收一次);回傳 `{ totalAmount, totalFee, totalCost, totalShares, avgCost }`。
- localStorage 自動 migrate 舊 schema(`buyPrice` + `quantity` → 單筆 `buyEntries`)。
- 行動底部 sticky 結果列加大(profit 19px / return 16px / min-height 68px / 進度條 8px)，手機觸控與視覺更舒適。

### Changed
- 「+ 加碼買進」按鈕採 **dashed border placeholder 風格**(`.add-entry-btn`)，與一般按鈕做視覺區分。
- 移除「交易數量」獨立欄位(整合進每筆加碼)，保留「張/股」單位選擇器為全域設定。
- 區間試算：做多用 aggregated `totalCost` 為固定側;做空多筆回補時中心 = 加權平均回補價(假想全部單一價回補)。
- snap 對齊損益兩平 / 目標報酬：做空模式改寫入第 1 筆 entry 的 price(其他筆維持)。
- **交易條件欄位順序重排**：做空時「借券費率 / 持有天數」改顯示在「交易方向」下方(原本在尾部);所有方向都把「單位」與「賣出價格」對調，現順序為：商品類型 → 交易方向 →(借券)→ 買進/回補列表 → 單位 → 賣出/放空價格 → 快捷對齊。
- **行動下買進列表改用 grid layout**：① 標號 / price stepper / × 同列、qty stepper /「張」label 同列;每筆 layout 一致(第 1 筆無 × 但保留欄位寬度)。
- **desktop 下 price 比 qty 寬**(`flex: 1.5 : 1`);第 2 筆以後用 `:nth-child(n+2)` 把 qty `flex-basis` 拉到 140px，補回 ×刪除按鈕擠占的空間，讓 qty 不至於太窄。mobile 維持同寬 grid layout。
- **第 10 筆達上限**時「+ 加碼買進」改用 `hidden` 完全隱藏(原本為 disabled 灰色顯示)。
- **區間試算與快捷對齊說明文字改寫**：移除「左側」「另一邊」等依賴位置的詞，改用直接點名「賣出價/回補價」「買進價/放空價」，行動上下排版下也清楚。
- 所有 user-visible 半形「,」一致改全形「，」(13 處)。

### Fixed
- **`.add-entry-btn[hidden]` 不生效**：`.add-entry-btn { display: block }` 蓋掉 UA `[hidden]` 預設，加 `.add-entry-btn[hidden] { display: none }` 補回(同 1.1.0 `.popover-host[hidden]` 修法的延伸)。
- **做空時 `#borrowField` 與下方 `#buyListField` 擠在一起**：`.row` 缺 `margin-bottom`，補 14px 對齊 `.field` 標準間距。

### Refactored
- **CSS 共用基礎重構**(零視覺變化，已用 computed-style 與 rule inspection 對齊 baseline 驗證)：
  - 新增 `--t-quick / --t-fast / --t-mid` transition 時間變數，17 處 transition 改用變數，改動效一致只動一處。
  - `button { font-family: inherit; cursor: pointer }` 與 `input, select { font-family: inherit }` 全域 reset，12 個 button class 與 3 個 input/select rule 內共 27 行重複移除。
  - `input[type=number]` 原生 spinner 全域隱藏(從 `.snap-target input` 升級為 generic rule)。
  - `font-variant-numeric: tabular-nums` 用 multi-selector 集中(10 處 selector 合併一條規則)。
  - 4 個 outlined button(`.btn-action` / `.btn-group button` / `.snap-action` / `.buy-entry-remove`)共用 `border + background + transition`;前 3 者共用 hover state(`.buy-entry-remove` 例外維持紅色危險樣式)。
  - icon button(`.gear-btn` / `.popover-close`)共用 base + hover。
  - 複合控制元件 wrapper(`.snap-target` / `.number-stepper`)共用 base + hover + focus-within。
  - `<style>` 區整體 -25 行;新元件加進 multi-selector list 即可繼承共用樣式。

### Limitations
- 多筆「賣」與部分出場暫不支援(只支援多筆買 / 多筆回補，全部賣出 / 全部回補)。
- 每筆加碼共用全域設定;不支援單筆獨立折扣 / 商品類型。

## [1.1.0] — 2026-05-27

### Added
- **PWA 支援**：加入 `manifest.json` 與 `sw.js`，cache-first 策略，首次造訪後完全離線可用。同源限制維持「零外部請求」承諾。
- **App icon** 雙版本：`icons/icon.svg`(深色，黑底)+ `icons/icon-light.svg`(淺色，白底+灰邊)，100×100 viewBox。
- **favicon 隨主題動態切換**：`applyTheme()` 切換 32×32 viewBox 的 data URL;`apple-touch-icon` 用 `prefers-color-scheme` media query 對應系統主題。
- **行動底部 sticky 結果列**(`@media (max-width: 760px)`)：即時顯示損益、報酬率、mini 進度條，結果卡片進入視窗 ≥50% 時用 IntersectionObserver 自動隱藏，點擊跳到完整結果。
- **三個高頻 input 加 +/− 步進按鈕**(買進價、賣出價、交易數量)：右側兩顆 ≥44px 觸控目標，沿用 `input.step`(買賣價為動態 tick)，支援單擊 ±step 與長按 350ms→100ms/次連續加減。鍵盤可用 Enter/Space 觸發。
- **行動裝置觸控目標全面 ≥44px**：`.btn-group button`、`.snap-action`、`.snap-target` 在 mobile 斷點加大 padding。
- **區間試算表加 horizontal overflow wrap**：避免窄螢幕被擠壓。
- **版本系統**：`APP_VERSION` 常數為單一來源，驅動 SW cache name(改一處全部失效);footer 顯示版本號;新增 `CHANGELOG.md`。

### Changed
- 底部結果列右側 CTA 從 `↑` 改為「詳情 →」，意圖更明確。

### Fixed
- **左右卡片不對稱**：`<input>` 預設 `size=20` 在 flex 容器內貢獻 ~220px 內在寬度，撐爆 grid `1fr 1fr`。`.number-stepper input` 從 `width: auto` 改為 `width: 0` 修正。
- **重置 confirm dialog 跑到左上角**：全域 `* { margin: 0 }` reset 蓋掉原生 `<dialog>` 的 `margin: auto`。加 `position: fixed; inset: 0; margin: auto;` 顯式置中。
- **`.popover-host[hidden]` 不生效**：`.popover-host { display: inline-block }` 蓋掉 `[hidden]` 預設樣式，加 `.popover-host[hidden] { display: none }` 補回。

## [1.0.0] — 2026-05-27

初始發布，涵蓋計算引擎與所有 UI 功能。

### 計算
- 手續費(`0.1425% × 折數`、最低 20 元、無條件捨去)
- 證交稅(一般 0.3% / ETF 0.1% / 當沖 0.15% / 免稅)
- 借券費(年化費率 × 持有天數 / 365)
- 損益、報酬率、損益兩平價、目標報酬反推
- 升降單位 (tick) 自動依股價區間切換

### UI
- 詳細試算 / 區間試算雙分頁(右卡頂部 tab 切換)
- 區間試算：以變動側(做多賣價、做空回補價)為中心，上下各 5 個 tick 共 11 列;中心列暖金色背景、中心損益用紅綠醒目區塊
- 進階設定齒輪 popover(手續費折扣 + 最低手續費)，寬度 420px、觸控目標 ≥44px
- 報酬率視覺進度條(±10% 視覺範圍，正紅負綠)
- 8 個輸入欄位即時驗證(紅框錯誤 / 黃框警示，`aria-invalid` + `aria-describedby`)
- 重置預設加 `<dialog>` 確認(置中、ESC / backdrop 關閉)
- 交易條件欄位順序：商品類型 → 交易方向 → 買賣價 → 數量 → 快捷對齊
- 商品類型 / 折扣 / 數量 / 區間範圍 快捷按鈕組
- 快捷對齊：對齊損益兩平、套用目標報酬率
- 主題切換(淺色 / 深色 / 跟隨系統)，`THEME_KEY` localStorage 持久化

### 持久化與互動
- 全部輸入欄位用 `STORAGE_KEY` localStorage 持久化(重整可接續上次試算)
- 區間範圍選擇用 `RANGE_KEY` 獨立持久化
- 當前分頁用 `TAB_KEY` 持久化
- 鍵盤滾輪微調 number input
- ARIA 標籤、focus ring、鍵盤可訪問
- 剪貼簿複製結果(`navigator.clipboard` + `execCommand` fallback)

### 品質
- 純前端、零依賴、零建置步驟
- 零 fetch / XHR / WebSocket / analytics / cookies / CDN
- `tests.html` 內含 109 個單元測試(`fmtMoney` / `calcFee` / `calcSide` / `calcBreakeven` / `calcTargetPrice` / `snapPriceToTick` / `getTickSize` / `calcScenarioProfit`)
