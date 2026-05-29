// 台股交易計算機 — 主應用邏輯
//
// 由 index.html 抽離 (v1.3.1),為了 HTML/CSS/JS 三層職責分離。
// 注意:<head> 內的 FOUC 防止 script 仍保留 inline,需在 CSS 解析前同步執行
// (設定 data-theme 與 data-app-mode),不能搬到此外部檔。

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.4.0';  // 改這裡 → 自動觸發 SW 換版 + footer 顯示
  const STORAGE_KEY = 'twStockCalc.settings.v1';
  const DIVIDEND_STORAGE_KEY = 'twStockCalc.dividend.v1';   // 除權息獨立持久化
  const APP_MODE_KEY = 'twStockCalc.appMode';                // 頂層模式
  const THEME_KEY = 'twStockCalc.theme';  // 主題獨立 key (供 head 內早於 style 的 script 讀取)
  const TAB_KEY = 'twStockCalc.activeTab';
  const RANGE_KEY = 'twStockCalc.rangeHalf';  // 區間試算上下列數
  // 全部輸入欄位都持久化,重新整理可直接接續上次的試算
  // buyEntries 為陣列,獨立處理 (不在 PERSIST_KEYS 字串清單中)
  const PERSIST_KEYS = ['direction', 'unit', 'sellPrice',
                        'productType', 'discount', 'minFee', 'borrowRate', 'borrowDays', 'targetReturn'];
  const DIVIDEND_PERSIST_KEYS = ['prePrice', 'cashDividend', 'stockDividend', 'dividendShares',
                                 'dividendBuyCost',
                                 'healthRate', 'healthThreshold', 'otherIncome'];
  const MAX_BUY_ENTRIES = 10;  // 加碼上限
  const ENTRY_NUMERALS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
  const DEFAULTS = {
    direction: 'long', unit: 'lot',
    buyEntries: [{ price: 100, qty: 1 }],
    sellPrice: 110,
    productType: 'stock', discount: 1, minFee: 20,
    borrowRate: 0.08, borrowDays: 1, targetReturn: 5,
  };
  const DIVIDEND_DEFAULTS = {
    prePrice: 50, cashDividend: 2.5, stockDividend: 0,
    dividendShares: 10, dividendUnit: 'lot',
    dividendBuyCost: 0,    // 0 = 不啟用成本降低試算
    healthRate: 2.11, healthThreshold: 20000,
    otherIncome: 600000,   // 落在 12% 級距
  };
  const TAX_RATES = { stock: 0.003, etf: 0.001, daytrade: 0.0015, none: 0 };
  const FEE_RATE = 0.001425;
  const THEME_COLORS = { light: '#f5f5f5', dark: '#000000' };  // 對應 meta theme-color
  // Favicon 雙版本 (data URL,瞬間切換無 network 請求)
  //   light = 白底 + 灰邊 (在淺色瀏覽器分頁仍可見);dark = 黑底
  const FAVICON_DARK  = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23111' rx='6'/><rect x='6' y='9' width='8' height='14' fill='%23d4302a'/><rect x='18' y='12' width='8' height='11' fill='%231f8f4f'/></svg>";
  const FAVICON_LIGHT = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='0.5' y='0.5' width='31' height='31' fill='%23fff' stroke='%23d0d0d0' rx='6'/><rect x='6' y='9' width='8' height='14' fill='%23d4302a'/><rect x='18' y='12' width='8' height='11' fill='%231f8f4f'/></svg>";
  const RANGE_HALF_OPTIONS = [5, 10, 20];  // 可選的上下列數
  const RANGE_HALF_DEFAULT = 5;
  const RETURN_BAR_CAP = 10;  // 進度條視覺上限 ±10%

  // 多筆加碼:deep clone 避免共用同一個物件 reference
  function cloneDefaultBuyEntries() {
    return DEFAULTS.buyEntries.map(e => ({ price: e.price, qty: e.qty }));
  }

  let unit = DEFAULTS.unit;
  let direction = DEFAULTS.direction;
  let productType = DEFAULTS.productType;
  let activeTab = 'detail';
  let rangeRowsHalf = RANGE_HALF_DEFAULT;  // 動態狀態
  let buyEntries = cloneDefaultBuyEntries();  // 多筆加碼,動態陣列
  let appMode = 'trade';                      // 'trade' | 'dividend'
  let dividendUnit = DIVIDEND_DEFAULTS.dividendUnit;   // 除權息獨立單位 (張/股)
  // 從 <head> 早於 style 的 init script 已設好 data-theme-mode,讀回來避免雙重邏輯
  let themeMode = document.documentElement.getAttribute('data-theme-mode') || 'auto';

  // ============================================================
  // 格式化
  // ============================================================
  function fmtNum(n, dp) {
    if (!isFinite(n) || isNaN(n)) return '-';
    return n.toLocaleString('zh-TW', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtMoney(n, dp) {
    if (!isFinite(n) || isNaN(n)) return '-';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (dp === undefined || dp === null) {
      // 嚴格判斷:小於 1e-6 才視為整數,避免漏顯示真的有小數的金額
      const hasDecimal = Math.abs(abs - Math.round(abs)) > 1e-6;
      dp = hasDecimal ? 2 : 0;
    }
    return sign + 'NT$ ' + fmtNum(abs, dp);
  }
  const round2 = n => Math.round(n * 100) / 100;

  // 折數顯示:1.0 → "原價",0.6 → "6折",0.38 → "3.8折",0.55 → "5.5折"
  function formatDiscount(d) {
    if (!isFinite(d) || d >= 1) return '原價';
    if (d <= 0) return String(d);
    const pct = d * 10;
    return parseFloat(pct.toFixed(2)).toString() + '折';
  }

  // ============================================================
  // 升降單位 (tick)
  // ============================================================
  function getTickSize(price, productType) {
    if (productType === 'etf') return price < 50 ? 0.01 : 0.05;
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.10;
    if (price < 500) return 0.50;
    if (price < 1000) return 1.00;
    return 5.00;
  }

  // ============================================================
  // 共用計算 helper
  // ============================================================
  function readInputs() {
    let discount = parseFloat($('discount').value);
    if (!isFinite(discount) || discount <= 0) discount = 1;
    if (discount > 1) discount = 1;

    const days = Math.max(0, parseFloat($('borrowDays').value) || 0);
    const annualBorrowRate = Math.max(0, (parseFloat($('borrowRate').value) || 0) / 100);
    const sharesPerUnit = unit === 'lot' ? 1000 : 1;

    return {
      buyEntries,                                                // 多筆加碼
      sellPrice: Math.max(0, parseFloat($('sellPrice').value) || 0),
      sharesPerUnit,
      discount,
      minFee: Math.max(0, parseFloat($('minFee').value) || 0),
      productType,
      taxRate: TAX_RATES[productType] ?? 0.003,
      // 實際借券費率 = 年化費率 × 天數 / 365,做多時為 0
      borrowEffRate: direction === 'short' ? annualBorrowRate * days / 365 : 0,
    };
  }

  // 計算手續費 (含最低門檻、無條件捨去)
  function calcFee(amount, discount, minFee) {
    if (amount <= 0) return 0;
    return Math.max(minFee, Math.floor(amount * FEE_RATE * discount));
  }

  // 計算單邊的金額、手續費、稅、借券費
  function calcSide(price, shares, discount, minFee, taxRate, borrowEffRate, isSell) {
    const amount = round2(price * shares);
    const fee = calcFee(amount, discount, minFee);
    const tax = isSell ? Math.floor(amount * taxRate) : 0;
    const borrowFee = isSell ? Math.floor(amount * borrowEffRate) : 0;
    return { amount, fee, tax, borrowFee };
  }

  // 多筆買進加碼:每筆獨立適用最低手續費 (券商每筆收一次)
  //   entries: [{ price, qty }, ...]
  //   sharesPerUnit: 'lot' → 1000, 'share' → 1
  //   無效 entry (price<=0 或 qty<=0) 自動跳過
  function calcMultiBuy(entries, sharesPerUnit, discount, minFee, taxRate) {
    let totalAmount = 0, totalFee = 0, totalShares = 0;
    for (const e of (entries || [])) {
      if (!e || e.price <= 0 || e.qty <= 0) continue;
      const shares = e.qty * sharesPerUnit;
      const side = calcSide(e.price, shares, discount, minFee, taxRate, 0, false);
      totalAmount += side.amount;
      totalFee += side.fee;
      totalShares += shares;
    }
    const totalCost = round2(totalAmount + totalFee);
    return {
      totalAmount: round2(totalAmount),
      totalFee,
      totalCost,
      totalShares,
      avgCost: totalShares > 0 ? round2(totalCost / totalShares) : 0,
    };
  }

  // 損益兩平價:做多 → 最低賣價;做空 → 最高回補價
  // 公式假設賣方手續費按比例;若按比例 < minFee,改用最低門檻反推
  function calcBreakeven({ totalCost, netSell, shares, discount, minFee, taxRate, dir }) {
    if (shares <= 0) return 0;
    if (dir === 'short') {
      const factor = 1 + FEE_RATE * discount;
      if (factor <= 0 || netSell <= 0) return 0;
      let be = netSell / (shares * factor);
      if (be * shares * FEE_RATE * discount < minFee) {
        be = (netSell - minFee) / shares;
      }
      return be;
    } else {
      const factor = 1 - FEE_RATE * discount - taxRate;
      if (factor <= 0) return 0;
      let be = totalCost / (shares * factor);
      if (be * shares * FEE_RATE * discount < minFee && (1 - taxRate) > 0) {
        be = (totalCost + minFee) / (shares * (1 - taxRate));
      }
      return be;
    }
  }

  // 達到指定報酬率所需的另一邊價格
  //   做多: 鎖定 buyPrice/totalCost,求 sellPrice 使 profit = targetRate × totalCost
  //   做空: 鎖定 sellPrice/netSell,求 buyPrice 使 profit = targetRate × sellAmount
  function calcTargetPrice({ totalCost, netSell, sellAmount, shares, discount, minFee, taxRate, dir, targetRate }) {
    if (shares <= 0) return 0;
    if (dir === 'short') {
      const targetProfit = targetRate * sellAmount;
      const targetBuyTotal = netSell - targetProfit; // 回補方的總現金支出 (含手續費)
      const factor = 1 + FEE_RATE * discount;
      if (factor <= 0 || targetBuyTotal <= 0) return 0;
      let price = targetBuyTotal / (shares * factor);
      if (price * shares * FEE_RATE * discount < minFee) {
        price = (targetBuyTotal - minFee) / shares;
      }
      return price;
    } else {
      const targetTotalIn = totalCost * (1 + targetRate); // 賣方需收回的金額 (扣費前)
      const factor = 1 - FEE_RATE * discount - taxRate;
      if (factor <= 0) return 0;
      let price = targetTotalIn / (shares * factor);
      if (price * shares * FEE_RATE * discount < minFee && (1 - taxRate) > 0) {
        price = (targetTotalIn + minFee) / (shares * (1 - taxRate));
      }
      return price;
    }
  }

  // 把價位對齊到合法 tick:做多賣價向上、做空回補價向下
  function snapPriceToTick(price, productType, dir) {
    const tick = getTickSize(price, productType);
    const eps = 1e-9;
    const aligned = dir === 'short'
      ? Math.floor((price + eps) / tick) * tick
      : Math.ceil((price - eps) / tick) * tick;
    return { value: aligned, decimals: tick < 1 ? 2 : 0 };
  }

  // ============================================================
  // 區間試算:給定一組 buyPrice/sellPrice,計算單一情境的損益
  //   做多: 改變 sellPrice,固定 buyPrice → 計算各 sellPrice 下的損益
  //   做空: 改變 buyPrice(回補價),固定 sellPrice → 計算各回補價下的損益
  //   為與「詳細試算」一致,基準 (報酬率分母) 同 calculate():
  //     long → totalCost(買進總成本);short → sellAmount(放空名目)
  // ============================================================
  function calcScenarioProfit({ buyPrice, sellPrice, shares, discount, minFee, taxRate, borrowEffRate, dir }) {
    if (shares <= 0 || buyPrice <= 0 || sellPrice <= 0) {
      return { profit: 0, returnRate: 0, totalCost: 0, netSell: 0 };
    }
    const buy = calcSide(buyPrice, shares, discount, minFee, taxRate, 0, false);
    const sell = calcSide(sellPrice, shares, discount, minFee, taxRate, borrowEffRate, true);
    const totalCost = round2(buy.amount + buy.fee);
    const netSell = round2(sell.amount - sell.fee - sell.tax - sell.borrowFee);
    const profit = round2(netSell - totalCost);
    const basis = dir === 'short' ? sell.amount : totalCost;
    const returnRate = basis > 0 ? (profit / basis) * 100 : 0;
    return { profit, returnRate, totalCost, netSell };
  }

  // ============================================================
  // 除權息計算
  // ------------------------------------------------------------
  // 名詞:
  //   - 現金股利 (cash):每股配發現金 (元)
  //   - 股票股利 (stock):每股配發股票之「面額金額」(元/股,面額 10 元為基準)
  //         例如配 1 元 = 每股配 0.1 股 = 1000 股變 1100 股
  // 公式:
  //   - 除權息參考價 = (除權息前股價 − 現金股利) / (1 + 股票股利 / 10)
  //   - 配股後股數   = 持股 × (1 + 股票股利 / 10)
  //   - 填權息漲幅   = (除權息前股價 / 參考價 − 1) × 100%   (目標即還原至前股價)
  //   - 殖利率       = 股利 / 除權息前股價 × 100%
  // 二代健保補充保費:單筆股利「給付金額」≥ 起徵點時,以該筆 × 費率收取
  // ============================================================
  const TAX_BRACKETS = [
    { limit:  590000, rate: 0.05 },
    { limit: 1330000, rate: 0.12 },
    { limit: 2660000, rate: 0.20 },
    { limit: 4980000, rate: 0.30 },
    { limit: 7470000, rate: 0.40 },
    { limit: Infinity, rate: 0.45 },
  ];
  const DIVIDEND_CREDIT_RATE = 0.085;
  const DIVIDEND_CREDIT_CAP  = 80000;
  const DIVIDEND_SEPARATE_RATE = 0.28;
  const HEALTH_INS_CAP = 10_000_000;  // 二代健保補充保費單次給付計收上限 (超過部分不扣)

  function calcExDividendPrice(prePrice, cashDividend, stockDividend) {
    if (!(prePrice > 0)) return 0;
    const cash  = Math.max(0, cashDividend  || 0);
    const stock = Math.max(0, stockDividend || 0);
    const denom = 1 + stock / 10;
    if (denom <= 0) return 0;
    return (prePrice - cash) / denom;
  }

  // 現金股利收入 + 二代健保補充保費
  //   依健保署規定 (https://www.nhi.gov.tw/ch/cp-2893-bba7c-3150-1.html):
  //     - 股票股利「以股票之面額每股 10 元計算」應扣補充保費 (非市價)
  //     - 同一基準日的現金股利與股票股利視為「同一次給付」,合併判定門檻
  //     - 單次給付達 20,000 元以上、未超過 1,000 萬部分才計入計收基數
  //     - 費率 2.11% (自 110/1/1 起)
  //     - 保費金額四捨五入到元 (對齊健保署 cloudicweb.nhi.gov.tw/esrv/trialbill 試算器)
  //   公式:
  //     - 現金 gross  = shares × cashDividend
  //     - 股票面額 gross = shares × stockDividend  (= 持股 × 股利元/股 = 面額金額)
  //     - totalGross = cash + stock face value
  //     - feeBase    = min(totalGross, 10,000,000)
  //     - healthIns  = totalGross >= threshold ? round(feeBase × rate) : 0
  //   補充保費全額從現金股利扣繳;若現金不足由股東另繳 (此處不分流,net 可能為負)
  //   第 5 個 arg `stockDividend` 為選填,沒提供時 stockGross = 0、不影響舊呼叫者
  function calcCashDividendIncome(shares, cashDividend, healthRate, healthThreshold, stockDividend) {
    const s     = Math.max(0, shares || 0);
    const cash  = Math.max(0, cashDividend || 0);
    const rate  = Math.max(0, healthRate || 0);
    const thr   = Math.max(0, healthThreshold || 0);
    const stock = Math.max(0, stockDividend || 0);
    const gross = round2(s * cash);
    const stockGross = round2(s * stock);   // 面額計算 (股利元 = 面額金額)
    const totalGross = round2(gross + stockGross);
    const feeBase    = Math.min(totalGross, HEALTH_INS_CAP);
    // 先取 4dp 清掉 JS 浮點雜訊 (2.11/100 在 IEEE 754 ≈ 0.021099999...,
    // 直接 round(25000 × rate) 會得 527 而非 528,與健保署試算器不一致)
    const feeAmount  = Math.round(feeBase * rate * 1e4) / 1e4;
    const healthIns  = totalGross >= thr ? Math.round(feeAmount) : 0;
    const net = round2(gross - healthIns);
    return { gross, stockGross, totalGross, healthIns, net };
  }

  function calcStockDividendShares(shares, stockDividend) {
    const s     = Math.max(0, shares || 0);
    const stock = Math.max(0, stockDividend || 0);
    const allocated = s * (stock / 10);
    const totalShares = s + allocated;
    const wholeShares = Math.floor(totalShares);
    const fractionalShares = totalShares - wholeShares;
    return { allocated, totalShares, wholeShares, fractionalShares };
  }

  // 除權息後每股成本降低多少
  //   buyPrice:      使用者輸入的每股買進均價
  //   shares:        原始持股 (股,已轉換)
  //   cashDividend:  每股現金股利
  //   stockDividend: 每股股票股利 (面額 10 元基準)
  //   healthInsFee:  二代健保補充保費 (從現金股利中扣除,以實領現金為準)
  //   邏輯:新每股成本 = (原總成本 − 實領現金) / 配股後總股數
  //   忽略買進手續費等成本(以使用者輸入的「均價」為單一基準)
  function calcCostReduction(buyPrice, shares, cashDividend, stockDividend, healthInsFee) {
    const p     = Math.max(0, buyPrice      || 0);
    const s     = Math.max(0, shares        || 0);
    const cash  = Math.max(0, cashDividend  || 0);
    const stock = Math.max(0, stockDividend || 0);
    const ins   = Math.max(0, healthInsFee  || 0);
    if (p <= 0 || s <= 0) {
      return { originalCost: 0, netCash: 0, newShares: 0, newCostTotal: 0,
               newCostPerShare: 0, costReduction: 0, costReductionPct: 0 };
    }
    const originalCost   = round2(p * s);
    const netCash        = round2(s * cash - ins);
    // 配股不改變總投入(白拿股票),只有現金股利會降總成本
    const newCostTotal   = round2(originalCost - netCash);
    const newShares      = s * (1 + stock / 10);
    const newCostPerShare = newShares > 0 ? round2(newCostTotal / newShares) : 0;
    const costReduction  = round2(p - newCostPerShare);
    const costReductionPct = p > 0 ? (costReduction / p) * 100 : 0;
    return { originalCost, netCash, newShares, newCostTotal,
             newCostPerShare, costReduction, costReductionPct };
  }

  function calcFillDividendGain(prePrice, refPrice) {
    if (!(prePrice > 0) || !(refPrice > 0)) return { gainPct: 0, targetPrice: 0 };
    return { gainPct: (prePrice / refPrice - 1) * 100, targetPrice: prePrice };
  }

  function calcDividendYield(cashDividend, stockDividend, prePrice) {
    if (!(prePrice > 0)) return { cash: 0, stock: 0, total: 0 };
    const cash  = Math.max(0, cashDividend  || 0) / prePrice * 100;
    const stock = Math.max(0, stockDividend || 0) / prePrice * 100;
    return { cash, stock, total: cash + stock };
  }

  // 累進稅:income 落在各級距按差額逐級加總 (台灣綜所稅 2024 年度級距)
  function calcProgressiveTax(income) {
    const inc = Math.max(0, income || 0);
    if (inc === 0) return 0;
    let tax = 0, prev = 0;
    for (const b of TAX_BRACKETS) {
      if (inc <= b.limit) { tax += (inc - prev) * b.rate; return tax; }
      tax += (b.limit - prev) * b.rate;
      prev = b.limit;
    }
    return tax;
  }

  // 股利課稅:比較合併課稅 + 8.5% 抵減 vs 28% 分離課稅
  //   方案 A 的「額外稅」是「加進股利的累進總稅」減「不加股利的累進總稅」
  //         — 這樣才精確,股利可能跨級距導致邊際稅率提升
  function calcDividendTax(dividendIncome, otherIncome) {
    const div   = Math.max(0, dividendIncome || 0);
    const other = Math.max(0, otherIncome || 0);
    // A:合併課稅 + 8.5% 抵減 (上限 8 萬 / 戶 / 年)
    const taxWith    = calcProgressiveTax(other + div);
    const taxWithout = calcProgressiveTax(other);
    const additionalTaxA = taxWith - taxWithout;
    const creditA = Math.min(div * DIVIDEND_CREDIT_RATE, DIVIDEND_CREDIT_CAP);
    const netA = additionalTaxA - creditA;   // 負值代表可退稅
    // B:28% 分離課稅
    const netB = div * DIVIDEND_SEPARATE_RATE;
    const better = netA <= netB ? 'A' : 'B';
    return {
      methodA: { additionalTax: additionalTaxA, credit: creditA, netTax: netA },
      methodB: { netTax: netB },
      better,
    };
  }

  // ============================================================
  // UI 同步
  // ============================================================
  // 渲染買進列表 (innerHTML 重畫,事件用 delegation 處理)
  //   每筆含 stepper (+/− 按鈕) 與升降單位提示;第 1 筆不渲染刪除按鈕
  //   渲染後重新跑 attach*Inputs (idempotent) 讓滾輪 + stepper 都能用
  function renderBuyList() {
    const list = $('buyList');
    if (!list) return;
    const unitLabel = unit === 'lot' ? '張' : '股';
    const count = buyEntries.length;
    list.innerHTML = buyEntries.map((entry, i) => {
      const num = ENTRY_NUMERALS[i] || ('(' + (i + 1) + ')');
      const tick = getTickSize(entry.price, productType);
      const priceValid = entry.price > 0;
      const removeBtn = i === 0 ? '' :
        '<button type="button" class="buy-entry-remove" aria-label="刪除第 ' + (i + 1) + ' 筆">×</button>';
      return '<div class="buy-entry" data-index="' + i + '">' +
        '<div class="buy-entry-line">' +
          '<span class="buy-entry-num" aria-hidden="true">' + num + '</span>' +
          '<div class="number-stepper">' +
            '<input class="buy-entry-price" type="number" ' +
              'value="' + entry.price + '" step="' + tick + '" min="0" ' +
              'inputmode="decimal" aria-label="第 ' + (i + 1) + ' 筆價格">' +
            '<button type="button" class="stepper-btn" data-step="dec" aria-label="減少第 ' + (i + 1) + ' 筆價格"></button>' +
            '<button type="button" class="stepper-btn" data-step="inc" aria-label="增加第 ' + (i + 1) + ' 筆價格"></button>' +
          '</div>' +
          '<span class="buy-entry-times" aria-hidden="true">×</span>' +
          '<div class="number-stepper">' +
            '<input class="buy-entry-qty" type="number" ' +
              'value="' + entry.qty + '" step="1" min="1" ' +
              'inputmode="numeric" aria-label="第 ' + (i + 1) + ' 筆數量">' +
            '<button type="button" class="stepper-btn" data-step="dec" aria-label="減少第 ' + (i + 1) + ' 筆數量"></button>' +
            '<button type="button" class="stepper-btn" data-step="inc" aria-label="增加第 ' + (i + 1) + ' 筆數量"></button>' +
          '</div>' +
          '<span class="buy-entry-unit">' + unitLabel + '</span>' +
          removeBtn +
        '</div>' +
        '<div class="buy-entry-tick' + (priceValid ? '' : ' invalid') + '">' +
          '升降單位 NT$ ' + tick.toFixed(2) +
        '</div>' +
      '</div>';
    }).join('');
    $('buyListCount').textContent = count;
    $('addBuyEntry').hidden = count >= MAX_BUY_ENTRIES;
    // 重新 attach wheel + steppers (兩者都 idempotent)
    if (typeof attachWheelToNumberInputs === 'function') attachWheelToNumberInputs();
    if (typeof attachSteppers === 'function') attachSteppers();
  }

  // 加碼 / 刪除
  function addBuyEntry() {
    if (buyEntries.length >= MAX_BUY_ENTRIES) return;
    // 用最後一筆的價量當預設,使用者方便修改
    const last = buyEntries[buyEntries.length - 1] || DEFAULTS.buyEntries[0];
    buyEntries.push({ price: last.price, qty: last.qty });
    renderBuyList();
    calculate();
    saveSettings();
  }
  function removeBuyEntry(index) {
    if (index <= 0 || index >= buyEntries.length) return;  // 第 1 筆不能刪
    buyEntries.splice(index, 1);
    renderBuyList();
    calculate();
    saveSettings();
  }

  // 顯示總股數 + 平均成本 (≥2 筆才顯示)
  function updateBuyListSummary(buyAgg) {
    const summary = $('buyListSummary');
    if (!summary) return;
    if (buyEntries.length < 2 || buyAgg.totalShares <= 0) {
      summary.hidden = true;
      return;
    }
    summary.hidden = false;
    $('buyTotalShares').textContent = fmtNum(buyAgg.totalShares, 0) + ' 股';
    $('buyAvgCost').textContent = 'NT$ ' + buyAgg.avgCost.toFixed(2);
  }

  function updateTickSizes() {
    const sp = parseFloat($('sellPrice').value) || 0;
    const sellTick = getTickSize(sp, productType);
    $('sellPrice').step = sellTick;
    $('sellTickHint').textContent = '升降單位 NT$ ' + sellTick.toFixed(2);
    // 買進列表內各筆 input 的 step 由 renderBuyList 處理
  }

  function updateDirectionUI() {
    if (direction === 'short') {
      $('buyListLabel').firstChild.textContent = '回補列表';
      $('sellPriceLabel').textContent = '放空價格 (元)';
      $('breakevenLabel').textContent = '損益兩平回補價';
      $('borrowField').style.display = '';
      $('borrowFeeRow').style.display = '';
    } else {
      $('buyListLabel').firstChild.textContent = '買進列表';
      $('sellPriceLabel').textContent = '賣出價格 (元)';
      $('breakevenLabel').textContent = '損益兩平賣價';
      $('borrowField').style.display = 'none';
      $('borrowFeeRow').style.display = 'none';
    }
  }

  function syncToggleGroups() {
    [...$('directionGroup').children].forEach(b => {
      const active = b.dataset.dir === direction;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    [...$('unitGroup').children].forEach(b => {
      const active = b.dataset.unit === unit;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    const d = parseFloat($('discount').value);
    [...$('discountGroup').children].forEach(b => {
      const active = Math.abs(parseFloat(b.dataset.discount) - d) < 0.001;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    syncThemeButton();
    [...$('productTypeGroup').children].forEach(b => {
      const active = b.dataset.product === productType;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    const rg = $('rangeGroup');
    if (rg) {
      [...rg.children].forEach(b => {
        const active = parseInt(b.dataset.half, 10) === rangeRowsHalf;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active);
      });
    }
  }

  // ============================================================
  // 主題切換
  //   themeMode: 'auto' | 'light' | 'dark'
  //   - auto: 根據 prefers-color-scheme 自動決定,並監聽系統變化
  //   - light/dark: 強制鎖定,不受系統影響
  // 為避免 FOUC,初始套用由 <head> 內 inline script 處理;這裡負責切換與持久化。
  // UI 為單一循環按鈕 (auto → light → dark → auto),圖示由 data-current-theme 屬性切換
  // ============================================================
  const THEME_ORDER = ['auto', 'light', 'dark'];
  const THEME_LABELS = { auto: '跟隨系統', light: '淺色', dark: '深色' };

  function syncThemeButton() {
    const btn = $('themeBtn');
    if (!btn) return;
    btn.setAttribute('data-current-theme', themeMode);
    const label = THEME_LABELS[themeMode] || themeMode;
    btn.setAttribute('aria-label', '切換主題(目前:' + label + ',點擊切換)');
    btn.title = '主題:' + label;
  }

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];
    applyTheme(next);
  }

  function applyTheme(mode) {
    if (mode !== 'auto' && mode !== 'light' && mode !== 'dark') mode = 'auto';
    themeMode = mode;
    const effective = mode === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme-mode', mode);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) metaThemeColor.setAttribute('content', THEME_COLORS[effective]);
    // Favicon 隨主題切換 (深色用黑底版,淺色用白底+灰邊版)
    const favicon = $('favicon');
    if (favicon) favicon.href = effective === 'dark' ? FAVICON_DARK : FAVICON_LIGHT;
    try { localStorage.setItem(THEME_KEY, mode); } catch (_) {}
    syncToggleGroups();
  }

  // 系統主題變化時,只在 auto 模式下跟著切
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeMode === 'auto') applyTheme('auto');
  });

  // ============================================================
  // 輸入驗證
  //   error (紅) = 阻塞性錯誤,值會讓計算失準
  //   warn  (黃) = 軟性警示,計算仍可進行
  // ============================================================
  const VALIDATORS = {
    sellPrice:    { type: 'error', test: v => v > 0,                            msg: '請輸入正數' },
    discount:     { type: 'error', test: v => v > 0 && v <= 1,                  msg: '折扣應介於 0 ~ 1 之間 (如 0.6 = 6 折)' },
    minFee:       { type: 'error', test: v => v >= 0,                           msg: '需 ≥ 0' },
    borrowDays:   { type: 'error', test: v => v >= 0 && Number.isInteger(v),    msg: '天數需 ≥ 0 整數' },
    borrowRate:   { type: 'warn',  test: v => v >= 0 && v <= 50,                msg: '年化費率超出常見範圍(0~50%)，請確認' },
    targetReturn: { type: 'warn',  test: v => v >= -100 && v <= 100,            msg: '報酬率超出常見範圍 (±100%)' },
  };
  function validateInputs() {
    Object.entries(VALIDATORS).forEach(([id, { type, test, msg }]) => {
      const el = $(id);
      if (!el) return;
      // 借券欄在做多時隱藏 → 跳過驗證避免誤標
      if ((id === 'borrowRate' || id === 'borrowDays') && direction !== 'short') {
        clearFieldError(id, el);
        return;
      }
      const v = parseFloat(el.value);
      const valid = isFinite(v) && test(v);
      const field = el.closest('.field');
      const errEl = $(id + 'Error');
      if (valid) {
        clearFieldError(id, el, field, errEl);
      } else {
        if (field) {
          field.classList.remove(type === 'error' ? 'has-warn' : 'has-error');
          field.classList.add('has-' + type);
        }
        el.setAttribute('aria-invalid', type === 'error' ? 'true' : 'false');
        el.setAttribute('aria-describedby', id + 'Error');
        if (errEl) errEl.textContent = msg;
      }
    });
    validateBuyEntries();
  }
  // 多筆買進驗證 (顯示在 #buyListField 上,訊息列在 #buyEntriesError)
  function validateBuyEntries() {
    const field = $('buyListField');
    const errEl = $('buyEntriesError');
    if (!field || !errEl) return;
    const errors = [];
    buyEntries.forEach((e, i) => {
      if (!(e.price > 0)) errors.push('第 ' + (i + 1) + ' 筆價格需 > 0');
      else if (!(e.qty >= 1 && Number.isInteger(e.qty))) errors.push('第 ' + (i + 1) + ' 筆數量需 ≥ 1 整數');
    });
    if (errors.length === 0) {
      field.classList.remove('has-error');
      errEl.textContent = '';
    } else {
      field.classList.add('has-error');
      errEl.textContent = errors[0] + (errors.length > 1 ? ' (另 ' + (errors.length - 1) + ' 項錯誤)' : '');
    }
  }
  function clearFieldError(id, el, field, errEl) {
    field = field || el.closest('.field');
    errEl = errEl || $(id + 'Error');
    if (field) field.classList.remove('has-error', 'has-warn');
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    if (errEl) errEl.textContent = '';
  }

  // ============================================================
  // 通用:把 returnRate 套到 ±cap% 視覺範圍的填充條 (left/right %)
  //   fill 元素需有 position:absolute, top/bottom:0
  // ============================================================
  function applyBarFill(fill, rr, cap) {
    const valid = isFinite(rr);
    const clipped = valid ? Math.max(-cap, Math.min(cap, rr)) : 0;
    const absPct = Math.abs(clipped) / cap * 50;
    if (clipped >= 0) {
      fill.style.left = '50%';
      fill.style.right = (50 - absPct) + '%';
    } else {
      fill.style.right = '50%';
      fill.style.left = (50 - absPct) + '%';
    }
    fill.classList.toggle('loss', clipped < 0);
  }

  // ============================================================
  // 報酬率視覺進度條
  //   視覺範圍 ±RETURN_BAR_CAP%,超出時加 overflow 條紋表示
  // ============================================================
  function updateReturnBar(rr) {
    const bar = $('returnBar');
    const fill = $('returnBarFill');
    if (!bar || !fill) return;
    applyBarFill(fill, rr, RETURN_BAR_CAP);
    const valid = isFinite(rr);
    bar.classList.toggle('overflow', valid && Math.abs(rr) > RETURN_BAR_CAP);
    bar.classList.toggle('overflow-pos', valid && rr > RETURN_BAR_CAP);
    bar.classList.toggle('overflow-neg', valid && rr < -RETURN_BAR_CAP);
  }

  // 行動底部 sticky 結果列 — 同步損益、報酬率、進度填充
  function updateMobileBar(profit, returnRate) {
    const bar = $('mobileResultBar');
    if (!bar) return;
    const profitEl = $('mobileBarProfit');
    const returnEl = $('mobileBarReturn');
    const fill = $('mobileBarFill');
    if (profitEl) {
      profitEl.textContent = (profit > 0 ? '+' : '') + fmtMoney(profit);
    }
    if (returnEl) {
      returnEl.textContent = (returnRate > 0 ? '+' : '')
        + (isFinite(returnRate) ? returnRate.toFixed(2) : '0.00') + '%';
    }
    bar.classList.toggle('profit', profit > 0);
    bar.classList.toggle('loss',   profit < 0);
    if (fill) applyBarFill(fill, returnRate, RETURN_BAR_CAP);
  }

  // ============================================================
  // 主計算
  // ============================================================
  function calculate() {
    updateTickSizes();
    validateInputs();
    const inp = readInputs();
    const { buyEntries: entries, sellPrice, sharesPerUnit, discount, minFee, taxRate, borrowEffRate } = inp;

    // 多筆買進加總 (每筆獨立適用最低手續費)
    const buyAgg = calcMultiBuy(entries, sharesPerUnit, discount, minFee, taxRate);
    const { totalAmount: buyAmount, totalFee: buyFee, totalCost, totalShares: shares, avgCost } = buyAgg;
    updateBuyListSummary(buyAgg);

    const sell = calcSide(sellPrice, shares, discount, minFee, taxRate, borrowEffRate, true);
    const netSell = round2(sell.amount - sell.fee - sell.tax - sell.borrowFee);

    const profit = round2(netSell - totalCost);
    const basis = direction === 'short' ? sell.amount : totalCost;
    const returnRate = basis > 0 ? (profit / basis * 100) : 0;
    const totalFees = buyFee + sell.fee + sell.tax + sell.borrowFee;

    const breakeven = calcBreakeven({
      totalCost, netSell, shares, discount, minFee, taxRate, dir: direction,
    });

    $('buyAmount').textContent     = fmtMoney(buyAmount);
    $('buyFee').textContent        = fmtMoney(buyFee);
    $('totalCost').textContent     = fmtMoney(totalCost);
    $('costPerShare').textContent  = shares > 0 ? 'NT$ ' + avgCost.toFixed(2) : '-';
    $('sellAmount').textContent    = fmtMoney(sell.amount);
    $('sellFee').textContent       = fmtMoney(sell.fee);
    $('tax').textContent           = fmtMoney(sell.tax);
    $('borrowFee').textContent     = fmtMoney(sell.borrowFee);
    $('netSell').textContent       = fmtMoney(netSell);
    $('netPerShare').textContent   = shares > 0 ? 'NT$ ' + (netSell / shares).toFixed(2) : '-';
    $('totalFees').textContent     = fmtMoney(totalFees);
    $('profit').textContent        = (profit > 0 ? '+' : '') + fmtMoney(profit);
    $('returnRate').textContent    = (returnRate > 0 ? '+' : '') + (isFinite(returnRate) ? returnRate.toFixed(2) : '0.00') + '%';
    $('breakeven').textContent     = breakeven > 0 ? 'NT$ ' + breakeven.toFixed(2) : '-';

    const cls = profit >= 0 ? 'profit' : 'loss';
    $('profitRow').className = 'result-row big ' + cls;
    $('returnRow').className = 'result-row ' + cls;
    updateReturnBar(returnRate);
    updateMobileBar(profit, returnRate);

    // 共用設定 (discount, minFee) 變動時,也同步更新區間試算
    renderRangeTable();
  }

  // ============================================================
  // 區間試算 — 渲染表格
  //   做多: 中心 = sellPrice,變動賣價、固定買價
  //   做空: 中心 = buyPrice(回補價),變動回補價、固定放空價
  //   公式與計算結果一致 → 使用同一 readInputs/calcSide/calcBreakeven 路徑
  // ============================================================
  function renderRangeTable() {
    const inp = readInputs();
    const { buyEntries: entries, sellPrice, sharesPerUnit, discount, minFee, taxRate, borrowEffRate } = inp;
    const isShort = direction === 'short';

    // 預先聚合多筆買進
    const buyAgg = calcMultiBuy(entries, sharesPerUnit, discount, minFee, taxRate);
    const shares = buyAgg.totalShares;
    const totalCost = buyAgg.totalCost;
    // 中心價 = 變動側
    //   做多: sellPrice (假想出場價)
    //   做空 多筆回補: 平均回補價 (假想全部單一價回補)
    const avgCover = shares > 0 ? round2(buyAgg.totalAmount / shares) : 0;
    const center = isShort ? avgCover : sellPrice;

    const body = $('rangeTableBody');
    const elFixedLabel = $('rangeFixedLabel');
    const elFixedValue = $('rangeFixedValue');
    const elBeLabel = $('rangeBreakevenLabel');
    const elBe = $('rangeBreakeven');
    const elCpLabel = $('rangeCenterProfitLabel');
    const elCp = $('rangeCenterProfit');
    const elCpRow = $('rangeCenterProfitRow');
    const elPriceLabel = $('rangePriceLabel');

    // 動態標籤
    elPriceLabel.textContent = isShort ? '回補價' : '賣出價';
    elBeLabel.textContent = isShort ? '損益兩平回補價' : '損益兩平賣價';
    elCpLabel.textContent = isShort ? '中心回補價損益' : '中心賣價損益';
    elFixedLabel.textContent = isShort ? '放空淨收入' : '買進總成本';

    if (shares <= 0 || center <= 0 || sellPrice <= 0) {
      body.innerHTML = '<tr><td colspan="3" class="empty">請於左側輸入有效的價格與數量</td></tr>';
      elFixedValue.textContent = '-';
      elBe.textContent = '-';
      elCp.textContent = '-';
      elCpRow.className = 'result-row big';
      return;
    }

    // 摘要:固定側金額 + 損益兩平
    let fixedAmt, be;
    let preCalcSell = null;
    if (isShort) {
      preCalcSell = calcSide(sellPrice, shares, discount, minFee, taxRate, borrowEffRate, true);
      const netSell = round2(preCalcSell.amount - preCalcSell.fee - preCalcSell.tax - preCalcSell.borrowFee);
      fixedAmt = netSell;
      be = calcBreakeven({ netSell, shares, discount, minFee, taxRate, dir: 'short' });
    } else {
      fixedAmt = totalCost;
      be = calcBreakeven({ totalCost, shares, discount, minFee, taxRate, dir: 'long' });
    }

    const tick = getTickSize(center, productType);
    const decimals = tick < 1 ? 2 : 0;

    // ±N 列圍繞中心 — 由高到低
    //   做多: 各列 = 假想 sellPrice;buy 側用實際聚合 totalCost
    //   做空: 各列 = 假想 cover price (全部 shares 單一價回補);sell 側用預先 calcSide
    const half = rangeRowsHalf;
    const rows = [];
    for (let i = half; i >= -half; i--) {
      const price = Math.max(0, round2(center + i * tick));
      let profit, returnRate;
      if (isShort) {
        const rowBuy = calcSide(price, shares, discount, minFee, taxRate, 0, false);
        const rowBuyCost = round2(rowBuy.amount + rowBuy.fee);
        const netSell = round2(preCalcSell.amount - preCalcSell.fee - preCalcSell.tax - preCalcSell.borrowFee);
        profit = round2(netSell - rowBuyCost);
        returnRate = preCalcSell.amount > 0 ? (profit / preCalcSell.amount) * 100 : 0;
      } else {
        const rowSell = calcSide(price, shares, discount, minFee, taxRate, 0, true);
        const rowNetSell = round2(rowSell.amount - rowSell.fee - rowSell.tax - rowSell.borrowFee);
        profit = round2(rowNetSell - totalCost);
        returnRate = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      }
      rows.push({ price, profit, returnRate, isCenter: i === 0 });
    }
    // 同步 help 文字裡的 N 與總列數
    const halfSpan = $('rangeHalfText');
    const totalSpan = $('rangeTotalText');
    if (halfSpan) halfSpan.textContent = half;
    if (totalSpan) totalSpan.textContent = (half * 2 + 1);

    // 摘要區
    elFixedValue.textContent = fmtMoney(fixedAmt);
    elBe.textContent = be > 0 ? 'NT$ ' + be.toFixed(2) : '-';
    const centerRow = rows.find(r => r.isCenter);
    if (centerRow) {
      const cp = centerRow.profit;
      const sign = cp > 0 ? '+' : '';
      elCp.textContent = sign + fmtMoney(cp);
      elCpRow.className = 'result-row big ' + (cp >= 0 ? 'profit' : 'loss');
    }

    body.innerHTML = rows.map(r => {
      const cls = r.profit > 0 ? 'profit-cell gain' : (r.profit < 0 ? 'profit-cell lose' : 'profit-cell');
      const profitSign = r.profit > 0 ? '+' : '';
      const rrSign = r.returnRate > 0 ? '+' : '';
      const profitDp = Math.abs(r.profit - Math.round(r.profit)) > 1e-6 ? 2 : 0;
      return '<tr class="' + (r.isCenter ? 'center' : '') + '">' +
        '<td>' + r.price.toFixed(decimals) + '</td>' +
        '<td class="' + cls + '">' + profitSign + fmtNum(r.profit, profitDp) + '</td>' +
        '<td class="' + cls + '">' + rrSign + (isFinite(r.returnRate) ? r.returnRate.toFixed(2) : '0.00') + '%</td>' +
        '</tr>';
    }).join('');
  }

  // ============================================================
  // Tab 切換
  // ============================================================
  function switchTab(name) {
    if (name !== 'detail' && name !== 'range') name = 'detail';
    activeTab = name;
    document.querySelectorAll('#tabNav button').forEach(b => {
      const active = b.dataset.tab === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.hidden = c.dataset.tab !== name;
    });
    // 區間齒輪只在 range tab 顯示;切離時順手關閉自己的 popover (不動條件齒輪)
    const gearHost = $('rangeGearHost');
    if (gearHost) gearHost.hidden = (name !== 'range');
    if (name !== 'range') {
      const pop = $('rangeGearPopover');
      const btn = $('rangeGearBtn');
      if (pop) pop.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
    if (name === 'range') renderRangeTable();
  }

  // ============================================================
  // 模式切換 (交易試算 / 除權息試算)
  // ------------------------------------------------------------
  // 兩個 layout 用 hidden 切換而非條件 render,避免事件 binding 重複附加
  // 切模式時關閉所有 popover、隱藏行動底部 bar (除權息模式)
  // ============================================================
  function applyMode(name) {
    if (name !== 'trade' && name !== 'dividend') name = 'trade';
    appMode = name;
    // data-app-mode 由 <head> 早期 script 設定 (避免 FOUC),這裡同步更新
    document.documentElement.setAttribute('data-app-mode', name);
    document.querySelectorAll('#modeGroup button').forEach(b => {
      const active = b.dataset.mode === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    const sub = $('appSubtitle');
    if (sub) sub.textContent = (name === 'dividend')
      ? '試算除權息參考價、配股配息與股利所得稅'
      : '試算手續費、證交稅與實際損益';
    closeAllPopovers();
    // 行動底部 sticky bar 只在交易模式有意義 (損益/報酬率)
    const mbar = $('mobileResultBar');
    if (mbar) mbar.classList.toggle('hidden-by-mode', name !== 'trade');
    try { localStorage.setItem(APP_MODE_KEY, name); } catch (_) {}
    if (name === 'dividend') calculateDividend();
    else calculate();
  }

  // ============================================================
  // 除權息計算
  // ============================================================
  const DIVIDEND_VALIDATORS = {
    prePrice:        { type: 'error', test: v => v > 0,                msg: '請輸入正數股價' },
    cashDividend:    { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
    stockDividend:   { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
    dividendShares:  { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
    dividendBuyCost: { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
    healthRate:      { type: 'warn',  test: v => v >= 0 && v <= 10,    msg: '費率超出常見範圍 (0~10%)' },
    healthThreshold: { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
    otherIncome:     { type: 'error', test: v => v >= 0,               msg: '需 ≥ 0' },
  };

  function validateDividendInputs() {
    Object.entries(DIVIDEND_VALIDATORS).forEach(([id, { type, test, msg }]) => {
      const el = $(id);
      if (!el) return;
      const v = parseFloat(el.value);
      const valid = isFinite(v) && test(v);
      const field = el.closest('.field');
      const errEl = $(id + 'Error');
      if (valid) {
        clearFieldError(id, el, field, errEl);
      } else {
        if (field) {
          field.classList.remove(type === 'error' ? 'has-warn' : 'has-error');
          field.classList.add('has-' + type);
        }
        el.setAttribute('aria-invalid', type === 'error' ? 'true' : 'false');
        el.setAttribute('aria-describedby', id + 'Error');
        if (errEl) errEl.textContent = msg;
      }
    });
    // 軟警示:現金與股票股利都為 0
    const cash  = parseFloat($('cashDividend').value)  || 0;
    const stock = parseFloat($('stockDividend').value) || 0;
    if (cash === 0 && stock === 0) {
      const field = $('cashDividend').closest('.field');
      const errEl = $('cashDividendError');
      if (field && !field.classList.contains('has-error')) {
        field.classList.add('has-warn');
        $('cashDividend').setAttribute('aria-describedby', 'cashDividendError');
        if (errEl) errEl.textContent = '現金與股票股利都為 0,沒有除權息可算';
      }
    }
  }

  function readDividendInputs() {
    const prePrice        = Math.max(0, parseFloat($('prePrice').value)        || 0);
    const cashDividend    = Math.max(0, parseFloat($('cashDividend').value)    || 0);
    const stockDividend   = Math.max(0, parseFloat($('stockDividend').value)   || 0);
    const dividendShares  = Math.max(0, parseFloat($('dividendShares').value)  || 0);
    const sharesPerUnit   = dividendUnit === 'lot' ? 1000 : 1;
    const totalShares     = dividendShares * sharesPerUnit;
    const dividendBuyCost = Math.max(0, parseFloat($('dividendBuyCost').value) || 0);
    const healthRate      = Math.max(0, parseFloat($('healthRate').value)      || 0) / 100;
    const healthThreshold = Math.max(0, parseFloat($('healthThreshold').value) || 0);
    const otherIncome     = Math.max(0, parseFloat($('otherIncome').value)     || 0);
    return { prePrice, cashDividend, stockDividend, dividendShares,
             sharesPerUnit, totalShares, dividendBuyCost,
             healthRate, healthThreshold, otherIncome };
  }

  // 邊際稅率:income 落在哪個級距
  function currentMarginalRate(income) {
    for (const b of TAX_BRACKETS) {
      if (income <= b.limit) return b.rate;
    }
    return TAX_BRACKETS[TAX_BRACKETS.length - 1].rate;
  }

  function calculateDividend() {
    validateDividendInputs();
    const inp = readDividendInputs();
    const { prePrice, cashDividend, stockDividend, totalShares,
            dividendBuyCost,
            healthRate, healthThreshold, otherIncome } = inp;

    const refPrice   = calcExDividendPrice(prePrice, cashDividend, stockDividend);
    const drop       = round2(prePrice - refPrice);
    const cashIncome = calcCashDividendIncome(totalShares, cashDividend, healthRate, healthThreshold,
                                              stockDividend);
    const stockAlloc = calcStockDividendShares(totalShares, stockDividend);
    const fill       = calcFillDividendGain(prePrice, refPrice);
    const yieldData  = calcDividendYield(cashDividend, stockDividend, prePrice);
    const costRed    = calcCostReduction(dividendBuyCost, totalShares, cashDividend, stockDividend, cashIncome.healthIns);

    // 股利所得 = 現金股利 + 股票股利(面額) 課稅
    const dividendIncome = round2(totalShares * cashDividend + totalShares * stockDividend);
    const taxData = calcDividendTax(dividendIncome, otherIncome);
    const marginalRate = currentMarginalRate(otherIncome + dividendIncome);

    renderDividend({
      prePrice, refPrice, drop,
      cashDividend, stockDividend, totalShares,
      dividendBuyCost, costRed,
      cashIncome, stockAlloc, fill, yieldData,
      dividendIncome, taxData, marginalRate, otherIncome,
    });
    saveDividendSettings();
  }

  function renderDividend(r) {
    // 參考價
    if (r.prePrice > 0 && (r.cashDividend > 0 || r.stockDividend > 0)) {
      $('exDivPrice').textContent = 'NT$ ' + r.refPrice.toFixed(2);
      $('priceDrop').textContent  = '-NT$ ' + r.drop.toFixed(2);
    } else {
      $('exDivPrice').textContent = '-';
      $('priceDrop').textContent  = '-';
    }

    // 現金股利收入
    $('dividendGross').textContent = fmtMoney(r.cashIncome.gross);
    // 補充保費合併計算:有股票股利時顯示合計給付 sub 行 + 法規說明
    const hasStock = r.cashIncome.stockGross > 0;
    const showFee  = r.cashIncome.healthIns > 0;
    $('healthInsRow').hidden      = !showFee;
    $('healthInsBasisRow').hidden = !(hasStock && showFee);
    $('healthInsHelp').hidden     = !hasStock;
    if (showFee) {
      $('healthInsFee').textContent = '-' + fmtMoney(r.cashIncome.healthIns);
      if (hasStock) {
        $('healthInsBasis').textContent =
          '現金 ' + fmtMoney(r.cashIncome.gross) +
          ' + 股票面額 ' + fmtMoney(r.cashIncome.stockGross) +
          ' = ' + fmtMoney(r.cashIncome.totalGross);
      }
    }
    $('dividendNet').textContent = fmtMoney(r.cashIncome.net);

    // 配股 (僅在股票股利 > 0 才顯示)
    const stockSection = $('stockAllocSection');
    if (r.stockDividend > 0 && r.totalShares > 0) {
      stockSection.hidden = false;
      $('allocatedShares').textContent  = fmtNum(r.stockAlloc.allocated, 2) + ' 股';
      $('totalSharesAfter').textContent = fmtNum(r.stockAlloc.totalShares, 2) + ' 股';
      $('wholeFractionShares').textContent =
        fmtNum(r.stockAlloc.wholeShares, 0) + ' 整股 + ' +
        r.stockAlloc.fractionalShares.toFixed(2) + ' 畸零股';
    } else {
      stockSection.hidden = true;
    }

    // 成本降低 (僅在使用者填寫買進成本 > 0 且有持股時顯示)
    const costSection = $('costReductionSection');
    if (r.dividendBuyCost > 0 && r.totalShares > 0 && (r.cashDividend > 0 || r.stockDividend > 0)) {
      costSection.hidden = false;
      $('newCostTotal').textContent     = fmtMoney(r.costRed.newCostTotal);
      $('newCostPerShare').textContent  = 'NT$ ' + r.costRed.newCostPerShare.toFixed(2);
      $('newCostReduction').textContent =
        '降 NT$ ' + r.costRed.costReduction.toFixed(2) + '/股 (' +
        r.costRed.costReductionPct.toFixed(2) + '%)';
    } else {
      costSection.hidden = true;
    }

    // 填權息
    if (r.refPrice > 0 && r.prePrice > 0) {
      $('fillGainPct').textContent      = r.fill.gainPct.toFixed(2) + '%';
      $('fillTargetPrice').textContent  = 'NT$ ' + r.fill.targetPrice.toFixed(2);
    } else {
      $('fillGainPct').textContent      = '-';
      $('fillTargetPrice').textContent  = '-';
    }

    // 殖利率
    $('cashYield').textContent = r.yieldData.cash.toFixed(2) + '%';
    const stockYieldRow = $('stockYieldRow');
    if (r.stockDividend > 0) {
      stockYieldRow.hidden = false;
      $('stockYield').textContent = r.yieldData.stock.toFixed(2) + '%';
    } else {
      stockYieldRow.hidden = true;
    }
    $('totalYield').textContent = r.yieldData.total.toFixed(2) + '%';

    // 股利所得稅
    $('marginalRateText').textContent = (r.marginalRate * 100).toFixed(0) + '%';
    $('otherIncomeText').textContent  = Math.round(r.otherIncome).toLocaleString('en-US');
    $('taxAddA').textContent    = fmtMoney(r.taxData.methodA.additionalTax);
    $('taxCreditA').textContent = '-' + fmtMoney(r.taxData.methodA.credit);
    const netA = r.taxData.methodA.netTax;
    $('taxNetA').textContent = netA < -0.5
      ? '退稅 ' + fmtMoney(Math.abs(netA))
      : fmtMoney(netA);
    $('taxNetB').textContent = fmtMoney(r.taxData.methodB.netTax);

    // 推薦標籤 (退稅情境也算 A 優)
    const aBetter = r.taxData.better === 'A';
    $('taxMethodABadge').hidden = !aBetter;
    $('taxMethodBBadge').hidden = aBetter;
    $('taxMethodA').classList.toggle('recommended', aBetter);
    $('taxMethodB').classList.toggle('recommended', !aBetter);

    // 合計股數提示
    $('dividendSharesTotal').textContent = Math.round(r.totalShares).toLocaleString('en-US');
  }

  function syncDividendUnitGroup() {
    document.querySelectorAll('#dividendUnitGroup button').forEach(b => {
      const active = b.dataset.dividendUnit === dividendUnit;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    const u = $('dividendSharesUnit');
    if (u) u.textContent = '(' + (dividendUnit === 'lot' ? '張' : '股') + ')';
  }

  function saveDividendSettings() {
    try {
      const data = { dividendUnit };
      DIVIDEND_PERSIST_KEYS.forEach(k => {
        if ($(k)) data[k] = $(k).value;
      });
      localStorage.setItem(DIVIDEND_STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }
  function loadDividendSettings() {
    try {
      const raw = localStorage.getItem(DIVIDEND_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.dividendUnit === 'lot' || data.dividendUnit === 'share') {
        dividendUnit = data.dividendUnit;
      }
      DIVIDEND_PERSIST_KEYS.forEach(k => {
        if (data[k] !== undefined && data[k] !== null && data[k] !== '' && $(k)) {
          $(k).value = data[k];
        }
      });
    } catch (_) {}
  }

  function doResetDividend() {
    try { localStorage.removeItem(DIVIDEND_STORAGE_KEY); } catch (_) {}
    dividendUnit = DIVIDEND_DEFAULTS.dividendUnit;
    $('prePrice').value        = DIVIDEND_DEFAULTS.prePrice;
    $('cashDividend').value    = DIVIDEND_DEFAULTS.cashDividend;
    $('stockDividend').value   = DIVIDEND_DEFAULTS.stockDividend;
    $('dividendShares').value  = DIVIDEND_DEFAULTS.dividendShares;
    $('dividendBuyCost').value = DIVIDEND_DEFAULTS.dividendBuyCost;
    $('healthRate').value      = DIVIDEND_DEFAULTS.healthRate;
    $('healthThreshold').value = DIVIDEND_DEFAULTS.healthThreshold;
    $('otherIncome').value     = DIVIDEND_DEFAULTS.otherIncome;
    syncDividendUnitGroup();
    calculateDividend();
    toast('已重置為預設值');
  }

  function buildDividendReportText() {
    const unitLabel = dividendUnit === 'lot' ? '張' : '股';
    const lines = [
      '台股除權息計算結果',
      '─────────────',
      '除權息前股價: ' + $('prePrice').value + ' 元',
      '現金股利: ' + $('cashDividend').value + ' 元/股',
      '股票股利: ' + $('stockDividend').value + ' 元/股',
      '持股: ' + $('dividendShares').value + ' ' + unitLabel + ' (= ' + $('dividendSharesTotal').textContent + ' 股)',
      '─────────────',
      '除權息參考價: ' + $('exDivPrice').textContent,
      '股價蒸發: ' + $('priceDrop').textContent,
      '填權息所需漲幅: ' + $('fillGainPct').textContent,
      '填權息目標價: ' + $('fillTargetPrice').textContent,
      '現金殖利率: ' + $('cashYield').textContent,
    ];
    if (!$('stockYieldRow').hidden) {
      lines.push('股票殖利率: ' + $('stockYield').textContent);
    }
    lines.push(
      '總殖利率: ' + $('totalYield').textContent,
      '─────────────',
      '現金股利收入: ' + $('dividendGross').textContent,
    );
    if (!$('healthInsRow').hidden) {
      lines.push('二代健保補充保費: ' + $('healthInsFee').textContent);
      if (!$('healthInsBasisRow').hidden) {
        lines.push('  合計給付: ' + $('healthInsBasis').textContent);
      }
    }
    lines.push('實領現金: ' + $('dividendNet').textContent);
    if (!$('stockAllocSection').hidden) {
      lines.push(
        '配股數: ' + $('allocatedShares').textContent,
        '配股後總股數: ' + $('totalSharesAfter').textContent,
        '整股/畸零股: ' + $('wholeFractionShares').textContent,
      );
    }
    if (!$('costReductionSection').hidden) {
      lines.push(
        '除權息後總持有成本: ' + $('newCostTotal').textContent +
          ' (每股 ' + $('newCostPerShare').textContent +
          ',' + $('newCostReduction').textContent + ')',
      );
    }
    lines.push(
      '─────────────',
      '邊際稅率: ' + $('marginalRateText').textContent,
      'A. 合併課稅 (8.5% 抵減) 淨稅: ' + $('taxNetA').textContent,
      'B. 分離課稅 (28%) 淨稅: ' + $('taxNetB').textContent,
      '推薦方案: ' + (!$('taxMethodABadge').hidden ? 'A 合併課稅' : 'B 分離課稅'),
    );
    return lines.join('\n');
  }

  // ============================================================
  // 快捷:對齊損益兩平 / 套用目標報酬
  // ============================================================
  // snap 函數適配多筆買進
  //   做多: 修改 sellPrice (不變)
  //   做空: 修改第 1 筆 buyEntries 的 price (代表「主要回補價」),其他筆維持
  function snapToBreakeven() {
    const inp = readInputs();
    const { sharesPerUnit, productType, discount, minFee, taxRate, borrowEffRate } = inp;
    const buyAgg = calcMultiBuy(buyEntries, sharesPerUnit, discount, minFee, taxRate);
    const shares = buyAgg.totalShares;
    if (shares <= 0) return toast('請先輸入有效的買進列表', true);

    if (direction === 'short') {
      const sell = calcSide(inp.sellPrice, shares, discount, minFee, taxRate, borrowEffRate, true);
      const netSell = round2(sell.amount - sell.fee - sell.tax - sell.borrowFee);
      const be = calcBreakeven({ netSell, shares, discount, minFee, taxRate, dir: 'short' });
      if (be <= 0) return toast('無法對齊到損益兩平', true);
      const { value, decimals } = snapPriceToTick(be, productType, 'short');
      buyEntries[0].price = parseFloat(value.toFixed(decimals));
      renderBuyList();
    } else {
      const be = calcBreakeven({ totalCost: buyAgg.totalCost, shares, discount, minFee, taxRate, dir: 'long' });
      if (be <= 0) return toast('無法對齊到損益兩平', true);
      const { value, decimals } = snapPriceToTick(be, productType, 'long');
      $('sellPrice').value = value.toFixed(decimals);
    }
    calculate();
    saveSettings();
    toast('已對齊到損益兩平價');
  }

  function snapToTarget() {
    const inp = readInputs();
    const { sharesPerUnit, productType, discount, minFee, taxRate, borrowEffRate } = inp;
    const targetPct = parseFloat($('targetReturn').value);
    if (!isFinite(targetPct)) return toast('請輸入有效的目標報酬率', true);
    const buyAgg = calcMultiBuy(buyEntries, sharesPerUnit, discount, minFee, taxRate);
    const shares = buyAgg.totalShares;
    if (shares <= 0) return toast('請先輸入有效的買進列表', true);
    const targetRate = targetPct / 100;

    if (direction === 'short') {
      const sell = calcSide(inp.sellPrice, shares, discount, minFee, taxRate, borrowEffRate, true);
      const netSell = round2(sell.amount - sell.fee - sell.tax - sell.borrowFee);
      const price = calcTargetPrice({
        netSell, sellAmount: sell.amount, shares, discount, minFee, taxRate,
        dir: 'short', targetRate,
      });
      if (price <= 0) return toast('目標報酬無法達成', true);
      const { value, decimals } = snapPriceToTick(price, productType, 'short');
      buyEntries[0].price = parseFloat(value.toFixed(decimals));
      renderBuyList();
    } else {
      const price = calcTargetPrice({
        totalCost: buyAgg.totalCost, shares, discount, minFee, taxRate,
        dir: 'long', targetRate,
      });
      if (price <= 0) return toast('目標報酬無法達成', true);
      const { value, decimals } = snapPriceToTick(price, productType, 'long');
      $('sellPrice').value = value.toFixed(decimals);
    }
    calculate();
    saveSettings();
    toast('已套用目標報酬 ' + targetPct + '%');
  }

  // ============================================================
  // 重置 / 複製
  // ============================================================
  function doReset() {
    // 各模式各重置各的 (避免誤清另一模式的設定)
    if (appMode === 'dividend') { doResetDividend(); return; }
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    try { localStorage.removeItem(RANGE_KEY); } catch (_) {}
    direction = DEFAULTS.direction;
    unit = DEFAULTS.unit;
    productType = DEFAULTS.productType;
    rangeRowsHalf = RANGE_HALF_DEFAULT;
    buyEntries = cloneDefaultBuyEntries();
    $('sellPrice').value    = DEFAULTS.sellPrice;
    $('discount').value     = DEFAULTS.discount;
    $('minFee').value       = DEFAULTS.minFee;
    $('borrowRate').value   = DEFAULTS.borrowRate;
    $('borrowDays').value   = DEFAULTS.borrowDays;
    $('targetReturn').value = DEFAULTS.targetReturn;
    syncToggleGroups();
    updateDirectionUI();
    renderBuyList();
    calculate();
    toast('已重置為預設值');
  }
  // 重置先跳確認 dialog;不支援 <dialog> 時 fallback 到 confirm()
  function showResetConfirm() {
    const dlg = $('confirmDialog');
    if (dlg && typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else if (window.confirm('將清除所有輸入並還原為預設值，確定要繼續嗎?')) {
      doReset();
    }
  }

  function buildReportText() {
    const isShort = direction === 'short';
    const unitLabel = unit === 'lot' ? '張' : '股';
    const buyLabel = isShort ? '回補' : '買進';
    const lines = [
      '台股交易計算結果',
      '─────────────',
      '方向: ' + (isShort ? '做空 (融券)' : '做多'),
      buyLabel + '列表 (共 ' + buyEntries.length + ' 筆):',
    ];
    buyEntries.forEach((e, i) => {
      const num = ENTRY_NUMERALS[i] || ('(' + (i + 1) + ')');
      lines.push('  ' + num + ' ' + e.price + ' 元 × ' + e.qty + ' ' + unitLabel);
    });
    lines.push(
      $('sellPriceLabel').textContent + ': ' + $('sellPrice').value + ' 元',
      '證交稅率: ' + ($('productTypeGroup').querySelector('button.active')?.textContent || productType),
      '手續費折扣: ' + formatDiscount(parseFloat($('discount').value)) + ' (' + $('discount').value + ')',
    );
    if (isShort) {
      lines.push('借券: 年化 ' + $('borrowRate').value + '% × ' + $('borrowDays').value + ' 天');
    }
    lines.push(
      '※' + $('breakevenLabel').textContent + ': ' + $('breakeven').textContent,
      '─────────────',
      '買進金額: ' + $('buyAmount').textContent,
      '買進手續費: ' + $('buyFee').textContent,
      '買進總成本: ' + $('totalCost').textContent,
      '每股實際成本: ' + $('costPerShare').textContent,
      '賣出金額: ' + $('sellAmount').textContent,
      '賣出手續費: ' + $('sellFee').textContent,
      '證交稅: ' + $('tax').textContent,
    );
    if (isShort) lines.push('借券費: ' + $('borrowFee').textContent);
    lines.push(
      '賣出淨收入: ' + $('netSell').textContent,
      '每股實際淨收: ' + $('netPerShare').textContent,
      '─────────────',
      '損益: ' + $('profit').textContent,
      '報酬率: ' + $('returnRate').textContent,
      '總交易成本: ' + $('totalFees').textContent,
    );
    return lines.join('\n');
  }

  async function copyResult() {
    const text = appMode === 'dividend' ? buildDividendReportText() : buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製到剪貼簿');
      return;
    } catch (_) { /* fallback to execCommand */ }
    // Fallback: 為 file:// 協議或不支援 Clipboard API 的情況
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('已複製到剪貼簿');
    } catch (_) {
      toast('複製失敗，請手動選取結果', true);
    }
    document.body.removeChild(ta);
  }

  function toast(msg, isErr) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ============================================================
  // localStorage 持久化(全部輸入欄位都記住)
  // ============================================================
  function saveSettings() {
    try {
      const data = { buyEntries };   // 陣列獨立 serialize
      PERSIST_KEYS.forEach(k => {
        if (k === 'direction') data[k] = direction;
        else if (k === 'unit') data[k] = unit;
        else if (k === 'productType') data[k] = productType;
        else data[k] = $(k).value;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.direction === 'long' || data.direction === 'short') direction = data.direction;
      if (data.unit === 'lot' || data.unit === 'share') unit = data.unit;
      if (data.productType && TAX_RATES[data.productType] !== undefined) productType = data.productType;
      ['sellPrice', 'discount', 'minFee', 'borrowRate', 'borrowDays', 'targetReturn'].forEach(k => {
        if (data[k] !== undefined && data[k] !== null && data[k] !== '') $(k).value = data[k];
      });
      // buyEntries 新 schema (含舊 buyPrice + quantity 自動 migrate)
      if (Array.isArray(data.buyEntries) && data.buyEntries.length > 0) {
        const cleaned = data.buyEntries
          .slice(0, MAX_BUY_ENTRIES)
          .map(e => ({
            price: Math.max(0, parseFloat(e && e.price) || 0),
            qty:   Math.max(1, Math.round(parseFloat(e && e.qty) || 1)),
          }))
          .filter(e => e.price > 0);
        if (cleaned.length > 0) buyEntries = cleaned;
      } else if (data.buyPrice !== undefined && data.quantity !== undefined) {
        // 舊 schema migrate → 單筆 entry
        buyEntries = [{
          price: Math.max(0, parseFloat(data.buyPrice) || DEFAULTS.buyEntries[0].price),
          qty:   Math.max(1, Math.round(parseFloat(data.quantity) || 1)),
        }];
      }
    } catch (_) {}
  }

  // ============================================================
  // 事件綁定
  // ============================================================
  ['sellPrice', 'discount', 'minFee', 'borrowRate', 'borrowDays'].forEach(id => {
    $(id).addEventListener('input', () => { calculate(); saveSettings(); });
    $(id).addEventListener('change', () => { calculate(); saveSettings(); });
  });
  $('targetReturn').addEventListener('input', () => { saveSettings(); validateInputs(); });

  // 買進列表 event delegation (input 改值 + 刪除按鈕)
  $('buyList').addEventListener('input', e => {
    const el = e.target;
    const entry = el.closest('.buy-entry');
    if (!entry) return;
    const idx = parseInt(entry.dataset.index, 10);
    if (!buyEntries[idx]) return;
    if (el.classList.contains('buy-entry-price')) {
      buyEntries[idx].price = parseFloat(el.value) || 0;
      // 即時更新該筆的 step 與 tick 提示 (不重畫整列避免 focus 跑掉)
      const tick = getTickSize(buyEntries[idx].price, productType);
      el.step = tick;
      const tickEl = entry.querySelector('.buy-entry-tick');
      if (tickEl) {
        tickEl.textContent = '升降單位 NT$ ' + tick.toFixed(2);
        tickEl.classList.toggle('invalid', !(buyEntries[idx].price > 0));
      }
    } else if (el.classList.contains('buy-entry-qty')) {
      buyEntries[idx].qty = parseFloat(el.value) || 0;
    }
    calculate();
    saveSettings();
  });
  $('buyList').addEventListener('click', e => {
    const removeBtn = e.target.closest('.buy-entry-remove');
    if (!removeBtn || removeBtn.disabled) return;
    const entry = removeBtn.closest('.buy-entry');
    const idx = parseInt(entry.dataset.index, 10);
    removeBuyEntry(idx);
  });
  $('addBuyEntry').addEventListener('click', addBuyEntry);

  $('directionGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    direction = e.target.dataset.dir;
    syncToggleGroups();
    updateDirectionUI();
    calculate();
    saveSettings();
  });

  $('unitGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    unit = e.target.dataset.unit;
    syncToggleGroups();
    renderBuyList();   // 單位變更要重新 render entry 上的單位文字
    calculate();
    saveSettings();
  });

  $('productTypeGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    productType = e.target.dataset.product;
    syncToggleGroups();
    renderBuyList();   // 商品類型變更會改變 tick,要重新 render entry 的 step
    calculate();
    saveSettings();
  });

  $('discountGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $('discount').value = e.target.dataset.discount;
    syncToggleGroups();
    calculate();
    saveSettings();
  });
  $('discount').addEventListener('input', syncToggleGroups);

  $('snapBreakeven').addEventListener('click', snapToBreakeven);
  $('snapTarget').addEventListener('click', snapToTarget);
  $('resetBtn').addEventListener('click', showResetConfirm);
  $('copyBtn').addEventListener('click', copyResult);

  // 重置確認 dialog 按鈕
  const confirmDlg = $('confirmDialog');
  if (confirmDlg) {
    $('confirmDialogCancel').addEventListener('click', () => confirmDlg.close());
    $('confirmDialogOk').addEventListener('click', () => {
      confirmDlg.close();
      doReset();
    });
    // 點 backdrop 關閉
    confirmDlg.addEventListener('click', e => {
      if (e.target === confirmDlg) confirmDlg.close();
    });
  }

  // 齒輪 popover 開合
  function closeAllPopovers() {
    document.querySelectorAll('.popover').forEach(p => { p.hidden = true; });
    document.querySelectorAll('.gear-btn[aria-expanded="true"]').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
    });
  }
  function togglePopover(btn) {
    const popId = btn.getAttribute('aria-controls');
    const pop = $(popId);
    if (!pop) return;
    const isOpen = !pop.hidden;
    closeAllPopovers();
    if (!isOpen) {
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
  }
  document.querySelectorAll('.gear-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover(btn);
    });
  });
  document.querySelectorAll('[data-close-popover]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeAllPopovers();
    });
  });
  // 點 popover 外側關閉 (不影響齒輪自身的 toggle)
  document.addEventListener('mousedown', e => {
    if (e.target.closest('.popover')) return;
    if (e.target.closest('.gear-btn')) return;
    closeAllPopovers();
  });
  // ESC 關閉 popover (dialog 自己會處理自己的 ESC)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllPopovers();
  });

  // 行動底部結果列 — 點擊滾到結果卡片
  const mobileBarTap = $('mobileBarTap');
  if (mobileBarTap) {
    mobileBarTap.addEventListener('click', () => {
      const resultCard = document.querySelector('.layout > .card:nth-child(2)');
      if (resultCard) resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // 行動底部結果列 — 結果卡片進入視窗時自動隱藏 (避免冗餘資訊)
  function setupMobileBarAutoHide() {
    const bar = $('mobileResultBar');
    const resultCard = document.querySelector('.layout > .card:nth-child(2)');
    if (!bar || !resultCard || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        // 結果卡片 ≥50% 進入視窗才視為「夠看」→ 隱藏底部 bar (使用者可以看到關鍵的損益區塊)
        bar.classList.toggle('hidden-by-scroll', entry.intersectionRatio > 0.5);
      });
    }, { threshold: [0, 0.3, 0.5, 0.7] });
    observer.observe(resultCard);
  }
  setupMobileBarAutoHide();

  $('themeBtn').addEventListener('click', cycleTheme);

  // Tab 切換
  $('tabNav').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    switchTab(e.target.dataset.tab);
  });

  // 模式切換 (頂層 segmented control)
  $('modeGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    applyMode(e.target.dataset.mode);
  });

  // 除權息輸入欄位
  ['prePrice', 'cashDividend', 'stockDividend', 'dividendShares', 'dividendBuyCost',
   'healthRate', 'healthThreshold', 'otherIncome'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input',  () => { calculateDividend(); });
    el.addEventListener('change', () => { calculateDividend(); });
  });

  // 除權息持股單位切換
  $('dividendUnitGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    dividendUnit = e.target.dataset.dividendUnit;
    syncDividendUnitGroup();
    calculateDividend();
  });

  // 區間試算範圍切換
  $('rangeGroup').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    const h = parseInt(e.target.dataset.half, 10);
    if (!RANGE_HALF_OPTIONS.includes(h)) return;
    rangeRowsHalf = h;
    syncToggleGroups();
    try { localStorage.setItem(RANGE_KEY, String(h)); } catch (_) {}
    renderRangeTable();
  });

  // ============================================================
  // 滾輪調整 number input(只綁在 number input 上,避免影響全域捲動)
  // ------------------------------------------------------------
  // 為什麼需要:Chromium 73+ 預設下,number input 即使聚焦,
  // 滾輪事件仍會被頁面捲動搶走。這裡只在 input 取得焦點時接管 wheel。
  //
  // 行為:
  //   - 步進量 = input 的 step (買賣價用動態 tick)
  //   - 遵守 min/max,小數位數依 step 決定
  //   - 改值後派發 input + change 事件,觸發 calculate
  //   - passive: false 才能 preventDefault
  // ============================================================
  function attachWheelToNumberInputs() {
    document.querySelectorAll('input[type=number]').forEach(el => {
      if (el.dataset.wheelAttached) return;   // 對動態加入的買進列 input 仍可重複呼叫
      el.dataset.wheelAttached = '1';
      el.addEventListener('wheel', (e) => {
        if (document.activeElement !== el || el.disabled || el.readOnly) return;
        e.preventDefault();
        const step = parseFloat(el.step) || 1;
        const min  = el.min !== '' ? parseFloat(el.min) : null;
        const max  = el.max !== '' ? parseFloat(el.max) : null;
        const cur  = parseFloat(el.value) || 0;
        let next = cur + (e.deltaY < 0 ? step : -step);
        if (min !== null && next < min) next = min;
        if (max !== null && next > max) next = max;
        const decimals = ((el.step || '1').split('.')[1] || '').length;
        el.value = next.toFixed(decimals);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { passive: false });
    });
  }

  // 步進按鈕:單擊 ±step,長按 350ms 後 100ms/次連續
  //   pointer 事件兼容滑鼠與觸控;沿用 input.step / min / max
  function attachSteppers() {
    const HOLD_DELAY = 350;
    const REPEAT_MS = 100;
    document.querySelectorAll('.number-stepper').forEach(wrap => {
      if (wrap.dataset.steppersAttached) return;   // 對動態加入的買進列也可重複呼叫
      wrap.dataset.steppersAttached = '1';
      const input = wrap.querySelector('input[type=number]');
      if (!input) return;
      wrap.querySelectorAll('.stepper-btn').forEach(btn => {
        const dir = btn.dataset.step === 'inc' ? 1 : -1;
        let holdTimer = null, repeatTimer = null;
        const doStep = () => {
          if (input.disabled || input.readOnly) return;
          const step = parseFloat(input.step) || 1;
          const min  = input.min !== '' ? parseFloat(input.min) : null;
          const max  = input.max !== '' ? parseFloat(input.max) : null;
          const cur  = parseFloat(input.value) || 0;
          let next = cur + dir * step;
          if (min !== null && next < min) next = min;
          if (max !== null && next > max) next = max;
          const decimals = ((input.step || '1').split('.')[1] || '').length;
          input.value = next.toFixed(decimals);
          input.dispatchEvent(new Event('input',  { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const stop = () => {
          clearTimeout(holdTimer);
          clearInterval(repeatTimer);
          holdTimer = repeatTimer = null;
          btn.classList.remove('holding');
        };
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();  // 避免觸控時連動 focus 行為
          doStep();
          btn.classList.add('holding');
          holdTimer = setTimeout(() => {
            repeatTimer = setInterval(doStep, REPEAT_MS);
          }, HOLD_DELAY);
        });
        // pointer 離開或鬆開都要停止
        ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev =>
          btn.addEventListener(ev, stop)
        );
        // 鍵盤可訪問:Enter / Space 觸發單擊 (long-press 對鍵盤不適用)
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            doStep();
          }
        });
      });
    });
  }

  // 為 tests.html 暴露純函數 (iframe 透過 window.__calc 存取)
  window.__calc = {
    fmtNum, fmtMoney, round2, getTickSize, formatDiscount,
    calcFee, calcSide, calcBreakeven, calcTargetPrice, snapPriceToTick,
    calcScenarioProfit, calcMultiBuy,   // // 除權息純函數
    calcExDividendPrice, calcCashDividendIncome, calcStockDividendShares,
    calcFillDividendGain, calcDividendYield, calcCostReduction,
    calcProgressiveTax, calcDividendTax,
    TAX_RATES, FEE_RATE,
    TAX_BRACKETS, DIVIDEND_CREDIT_RATE, DIVIDEND_CREDIT_CAP, DIVIDEND_SEPARATE_RATE,
    HEALTH_INS_CAP,
  };

  // ============================================================
  // 啟動
  // ============================================================
  loadSettings();
  loadDividendSettings();
  applyTheme(themeMode);  // 同步 meta theme-color + 按鈕狀態 (CSS 已由 head 內 script 套用)
  // 還原上次的分頁
  try {
    const savedTab = localStorage.getItem(TAB_KEY);
    if (savedTab === 'detail' || savedTab === 'range') activeTab = savedTab;
  } catch (_) {}
  // 還原區間範圍
  try {
    const savedHalf = parseInt(localStorage.getItem(RANGE_KEY), 10);
    if (RANGE_HALF_OPTIONS.includes(savedHalf)) rangeRowsHalf = savedHalf;
  } catch (_) {}
  // 還原模式
  try {
    const savedMode = localStorage.getItem(APP_MODE_KEY);
    if (savedMode === 'trade' || savedMode === 'dividend') appMode = savedMode;
  } catch (_) {}
  syncToggleGroups();
  updateDirectionUI();
  syncDividendUnitGroup();
  renderBuyList();   // 初始畫出買進列表
  attachWheelToNumberInputs();
  attachSteppers();
  calculate();
  switchTab(activeTab);
  saveSettings();   // 確保啟動時舊 schema 立即升到新 schema (含 buyEntries)
  applyMode(appMode);   // 套用初始模式 (含 trade 模式也跑一次,把 layout/footer 對齊)

  // Footer 版本標示
  const versionTag = $('appVersionTag');
  if (versionTag) versionTag.textContent = 'v' + APP_VERSION;

  // PWA — 註冊 Service Worker
  //   - 帶 ?v=APP_VERSION:版本變動會被視為新 SW → 自動清舊 cache + 立即接管
  //   - 跳過 file:// 協議 (SW 在 file:// 不工作,避免無謂 console error)
  //   - 失敗無聲,不影響網頁本身功能
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=' + APP_VERSION).catch(() => {});
    });
  }
