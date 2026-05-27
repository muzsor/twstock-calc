# 台股交易計算機

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-success.svg)](#開發)

線上試算台股交易的手續費、證交稅、借券費與實際損益，並反推損益兩平價、目標報酬價。

> 🔗 **線上版**: https://muzsor.github.io/twstock-calc/
> 📋 **變更紀錄**: [CHANGELOG.md](CHANGELOG.md)

## 預覽

| 淺色模式 | 深色模式 |
|:---:|:---:|
| ![淺色模式](docs/screenshot-light.png) | ![深色模式](docs/screenshot-dark.png) |

## 功能

左側「交易條件」永遠顯示，右側用分頁切換「詳細試算 / 區間試算」兩種輸出。

### 交易條件(共用輸入)

- ✅ 支援 **做多** 與 **做空(融券)** 兩種方向
- ✅ 商品類型按鈕組:**一般 (0.3%) / ETF (0.1%) / 當沖 (0.15%) / 免稅**
- ✅ 自訂手續費折扣(快捷:原價/6/5/3.8/2.8 折)與最低手續費(預設 20 元)
- ✅ 融券借券費按 **年化費率 × 持有天數 / 365** 計算
- ✅ **快捷對齊** — 一鍵把賣價/回補價對齊到損益兩平或任意目標報酬率

### 詳細試算分頁

- ✅ 顯示完整的買進金額、買進手續費、買進總成本、每股實際成本
- ✅ 顯示完整的賣出金額、賣出手續費、證交稅、借券費、賣出淨收入、每股實際淨收
- ✅ 顯示損益、報酬率、損益兩平價、總交易成本

### 區間試算分頁

- ✅ 自動以 **賣出價(做多)** 或 **回補價(做空)** 為中心，上下各 5 個升降單位，共 11 列損益試算
- ✅ 摘要顯示固定側金額(買進總成本 / 放空淨收入)、損益兩平、中心價損益
- ✅ 中心列以金色高亮，正/負損益以台股慣例上下色顯示
- ✅ 完全沿用左側交易條件設定(切換商品類型、折扣、方向後表格立即更新)

### 共用

- ✅ 自動依股價區間切換正確的升降單位(tick)
- ✅ **淺色 / 深色 / 跟隨系統** 三段式主題切換，記憶選擇
- ✅ 設定自動儲存於 localStorage(僅本機)
- ✅ 支援鍵盤滾輪微調數值
- ✅ 完整鍵盤可訪問性 + ARIA 標籤

## 計算公式

| 項目 | 公式 | 備註 |
|---|---|---|
| 手續費 | `成交金額 × 0.1425% × 折數`，無條件捨去，最低 20 元 | 法定上限 |
| 證交稅 | `成交金額 × 稅率`，無條件捨去 | 僅賣方繳 |
| 借券費 | `成交金額 × 年化費率 × 天數 / 365`，無條件捨去 | 僅融券放空 |
| 淨收入 | `賣出金額 - 賣出手續費 - 證交稅 - 借券費` | |
| 總成本 | `買進金額 + 買進手續費` | |
| 損益 | `淨收入 - 總成本` | |
| 報酬率 | 做多: `損益 / 總成本`<br>做空: `損益 / 放空名目` | |

### 損益兩平價

當賣方手續費按比例計算大於最低手續費時:

- **做多**: `breakeven = totalCost / (shares × (1 - feeRate × discount - taxRate))`
- **做空**: `breakeven = netSell / (shares × (1 + feeRate × discount))`

若按比例會低於最低手續費，改用 minFee 反推。

### 區間試算公式

每一列都使用與詳細試算相同的完整公式(雙邊手續費 + 證交稅 + 借券費)，只是讓「變動側」的價格隨著表格列上下移動:

- **做多**:固定買進價，變動賣出價(中心 = `sellPrice`，上下各 5 個 tick)
- **做空**:固定放空價，變動回補價(中心 = `buyPrice`，上下各 5 個 tick)

對每一列:

- `損益 = 賣出淨收入 - 買進總成本`
- `報酬率`:做多以 `買進總成本` 為基準、做空以 `放空名目` 為基準

由於與詳細試算共用公式，中心列的損益會與詳細試算分頁顯示的損益完全相同。

### 升降單位 (Tick)

| 股價區間 | 一般股票 | ETF |
|---|---|---|
| < 10 元 | 0.01 | 0.01 (< 50) |
| 10–50 | 0.05 | 0.01 (< 50) |
| 50–100 | 0.10 | 0.05 (≥ 50) |
| 100–500 | 0.50 | 0.05 |
| 500–1000 | 1.00 | 0.05 |
| ≥ 1000 | 5.00 | 0.05 |

## 開發

純前端、零依賴、零建置步驟。直接用瀏覽器開啟 `index.html` 即可使用。

### 本機啟動

```bash
# 任何靜態 server 都可以，例如 Python 內建的:
python -m http.server 8765
# 然後開 http://localhost:8765/
```

或直接以 `file://` 協議開啟 `index.html`(`navigator.clipboard` 在 file:// 下會 fallback 到 `execCommand`,Service Worker 在 file:// 下會自動跳過)。

### PWA(可加到主畫面)

線上版(HTTPS)或本機 http server 下,瀏覽器會自動註冊 Service Worker:

- **Android Chrome**:網址列出現「安裝」icon → 加到桌面變獨立 app
- **iOS Safari**:「分享 → 加到主畫面」
- **離線可用**:首次造訪後完全離線(cache-first 策略)

### 版本管理

- 版本號採 [Semantic Versioning](https://semver.org/lang/zh-TW/),變更記錄於 [CHANGELOG.md](CHANGELOG.md)
- 改版只需更新 `index.html` 的 `const APP_VERSION`,SW 會自動換新 cache
- footer 右下顯示當前版本號

### 單元測試

開啟 [tests.html](tests.html) 即可看到 101 個單元測試的執行結果。

測試透過 `<iframe>` 載入 `index.html`，讀取 `window.__calc` 暴露的純函數來驗證計算邏輯(`fmtMoney` / `calcFee` / `calcSide` / `calcBreakeven` / `calcTargetPrice` / `snapPriceToTick` / `getTickSize` / `calcScenarioProfit`)。

UI 互動(reset/copy/snap 按鈕、localStorage 持久化、滾輪、direction 切換、Tab 切換、商品類型按鈕)需手動驗證。

## 隱私

本工具 **完全在瀏覽器本機運作**:

- 🚫 沒有任何 fetch / XHR / WebSocket — 計算結果不離開瀏覽器
- 🚫 沒有 analytics、tracking、cookies
- 🚫 沒有第三方 CDN 依賴(連 favicon 都是 inline SVG)
- 🚫 Service Worker 只快取本地資源(`index.html` / `tests.html` / `manifest.json` / `icons/icon.svg`),**跨域請求一律跳過、不代理**
- ✅ localStorage 是 per-origin，使用者輸入只存在自己的瀏覽器

## 免責聲明

本工具僅供試算參考，**不構成任何投資建議**。

- 手續費以各券商實際收取為準，可能因服務方案、電子下單而異
- 稅率、費率依政府法規，如有變動請以最新版本為準
- 借券費率與計算方式因券商與商品而異
- 程式可能存在 bug，實際損益請以券商交割單為主
- 開發者不對計算結果之準確性或使用後果負任何責任

軟體依 [MIT License](LICENSE) 之 "AS IS" 條款提供，不附帶任何明示或暗示之擔保。

## 授權

[MIT](LICENSE)
