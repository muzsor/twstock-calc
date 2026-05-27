# 變更紀錄

本專案採用 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式;版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [1.1.0] — 2026-05-27

### Added
- **PWA 支援**:加入 `manifest.json` 與 `sw.js`,cache-first 策略,首次造訪後完全離線可用。同源限制維持「零外部請求」承諾。
- **App icon** 雙版本:`icons/icon.svg`(深色,黑底)+ `icons/icon-light.svg`(淺色,白底+灰邊),100×100 viewBox。
- **favicon 隨主題動態切換**:`applyTheme()` 切換 32×32 viewBox 的 data URL;`apple-touch-icon` 用 `prefers-color-scheme` media query 對應系統主題。
- **行動底部 sticky 結果列**(`@media (max-width: 760px)`):即時顯示損益、報酬率、mini 進度條,結果卡片進入視窗 ≥50% 時用 IntersectionObserver 自動隱藏,點擊跳到完整結果。
- **三個高頻 input 加 +/− 步進按鈕**(買進價、賣出價、交易數量):右側兩顆 ≥44px 觸控目標,沿用 `input.step`(買賣價為動態 tick),支援單擊 ±step 與長按 350ms→100ms/次連續加減。鍵盤可用 Enter/Space 觸發。
- **行動裝置觸控目標全面 ≥44px**:`.btn-group button`、`.snap-action`、`.snap-target` 在 mobile 斷點加大 padding。
- **區間試算表加 horizontal overflow wrap**:避免窄螢幕被擠壓。
- **版本系統**:`APP_VERSION` 常數為單一來源,驅動 SW cache name(改一處全部失效);footer 顯示版本號;新增 `CHANGELOG.md`。

### Changed
- 底部結果列右側 CTA 從 `↑` 改為「詳情 →」,意圖更明確。

### Fixed
- **左右卡片不對稱**:`<input>` 預設 `size=20` 在 flex 容器內貢獻 ~220px 內在寬度,撐爆 grid `1fr 1fr`。`.number-stepper input` 從 `width: auto` 改為 `width: 0` 修正。
- **重置 confirm dialog 跑到左上角**:全域 `* { margin: 0 }` reset 蓋掉原生 `<dialog>` 的 `margin: auto`。加 `position: fixed; inset: 0; margin: auto;` 顯式置中。
- **`.popover-host[hidden]` 不生效**:`.popover-host { display: inline-block }` 蓋掉 `[hidden]` 預設樣式,加 `.popover-host[hidden] { display: none }` 補回。

## [1.0.0] — 2026-05-26

初始發布,涵蓋計算引擎與所有 UI 功能。

### 計算
- 手續費(`0.1425% × 折數`、最低 20 元、無條件捨去)
- 證交稅(一般 0.3% / ETF 0.1% / 當沖 0.15% / 免稅)
- 借券費(年化費率 × 持有天數 / 365)
- 損益、報酬率、損益兩平價、目標報酬反推
- 升降單位 (tick) 自動依股價區間切換

### UI
- 詳細試算 / 區間試算雙分頁(右卡頂部 tab 切換)
- 區間試算:以變動側(做多賣價、做空回補價)為中心,上下各 5 個 tick 共 11 列;中心列暖金色背景、中心損益用紅綠醒目區塊
- 進階設定齒輪 popover(手續費折扣 + 最低手續費),寬度 420px、觸控目標 ≥44px
- 報酬率視覺進度條(±10% 視覺範圍,正紅負綠)
- 8 個輸入欄位即時驗證(紅框錯誤 / 黃框警示,`aria-invalid` + `aria-describedby`)
- 重置預設加 `<dialog>` 確認(置中、ESC / backdrop 關閉)
- 交易條件欄位順序:商品類型 → 交易方向 → 買賣價 → 數量 → 快捷對齊
- 商品類型 / 折扣 / 數量 / 區間範圍 快捷按鈕組
- 快捷對齊:對齊損益兩平、套用目標報酬率
- 主題切換(淺色 / 深色 / 跟隨系統),`THEME_KEY` localStorage 持久化

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
