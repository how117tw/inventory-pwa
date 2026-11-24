/* ===== 基本設定：依你的環境調整 ===== */
const API_URL    = 'https://script.google.com/macros/s/AKfycbxylbWYd385ziInsNEZU8qffWG0fpxTjFwq_ZuXXqzfvVSwEsY7uF5kIiWwXl2z8BPZxQ/exec';
const API_SECRET = 'Tgg_45499448_Tmg';

const DB_NAME    = 'inventoryPWA';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

/* ===== IndexedDB ===== */
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: false });
        store.createIndex('byCreated', 'createdAt');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
  return dbPromise;
}

async function addPending(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

async function getAllPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.index('byCreated').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

async function removePending(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

/* ===== 工具 ===== */
function uuid() {
  return 'L' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function vibrateOk()    { if (navigator.vibrate) navigator.vibrate(20); }
function vibrateError() { if (navigator.vibrate) navigator.vibrate([40,30,40]); }

function setNetStatus() {
  const el = document.getElementById('netStatus');
  if (navigator.onLine) {
    el.textContent = '已連線';
    el.classList.remove('offline');
  } else {
    el.textContent = '離線中';
    el.classList.add('offline');
  }
}

async function updateQueueStatus() {
  const data = await getAllPending();
  const unsynced = data.filter(d => !d.syncedAt);
  const el = document.getElementById('queueStatus');
  if (!unsynced.length) {
    el.textContent = '無待同步';
    el.classList.add('muted');
  } else {
    el.textContent = `尚有 ${unsynced.length} 筆待同步`;
    el.classList.remove('muted');
  }
}

/* ===== DOM ===== */
const invDateEl      = document.getElementById('invDate');
const whEl           = document.getElementById('warehouse');
const lockHeaderEl   = document.getElementById('lockHeader');
const settingsPanel  = document.getElementById('settingsPanel');
const btnToggleSettings = document.getElementById('btnToggleSettings');

const barcodeEl      = document.getElementById('barcode');
const qtyEl          = document.getElementById('qty');
const btnSubmit      = document.getElementById('btnSubmit');
const recentEl       = document.getElementById('recent');

const btnSync        = document.getElementById('btnSync');
const btnClearSheet  = document.getElementById('btnClearSheet');
const emailEl        = document.getElementById('email');
const btnExport      = document.getElementById('btnExport');

const searchBarcodeEl = document.getElementById('searchBarcode');
const btnSearchReset  = document.getElementById('btnSearchReset');

/* ===== 初始化 Header（盤點日 / 庫別 / 鎖定 / 收合） ===== */
(function initHeader(){
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = String(today.getMonth()+1).padStart(2,'0');
  const dd   = String(today.getDate()).padStart(2,'0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  invDateEl.value = localStorage.getItem('invDate') || todayStr;
  whEl.value      = localStorage.getItem('warehouse') || '';

  invDateEl.addEventListener('change', () => {
    if (lockHeaderEl.checked) return; // 鎖定時不改
    localStorage.setItem('invDate', invDateEl.value);
    renderRecent();
  });

  // ★ 庫別輸入：可正常打字、清空；鎖定時直接忽略
  whEl.addEventListener('input', () => {
    if (lockHeaderEl.checked) return;

    whEl.value = whEl.value
      .toUpperCase()
      .replace(/[^A-Z0-9\-]/g,'')
      .slice(0,5);

    localStorage.setItem('warehouse', whEl.value);
    renderRecent();
  });

  // 鎖定設定（預設不鎖定，避免一開始無法輸入庫別）
  const savedLock = localStorage.getItem('lockHeader');
  const locked = savedLock === '1';   // 只有 '1' 代表鎖定
  lockHeaderEl.checked = locked;
  applyHeaderLock();

  if (savedLock === null) {
    // 第一次使用時記錄為未鎖定
    localStorage.setItem('lockHeader', '0');
  }

  lockHeaderEl.addEventListener('change', () => {
    localStorage.setItem('lockHeader', lockHeaderEl.checked ? '1' : '0');
    applyHeaderLock();
  });

  // 收合狀態
  const collapsed = localStorage.getItem('settingsCollapsed') === '1';
  if (collapsed) {
    settingsPanel.classList.add('collapsed');
    btnToggleSettings.textContent = '▼ 展開設定';
  } else {
    btnToggleSettings.textContent = '▲ 收合設定';
  }

  btnToggleSettings.addEventListener('click', () => {
    settingsPanel.classList.toggle('collapsed');
    const isCollapsed = settingsPanel.classList.contains('collapsed');
    btnToggleSettings.textContent = isCollapsed ? '▼ 展開設定' : '▲ 收合設定';
    localStorage.setItem('settingsCollapsed', isCollapsed ? '1' : '0');
  });
})();

function applyHeaderLock() {
  const locked = lockHeaderEl.checked;
  invDateEl.disabled = locked;
  whEl.disabled      = locked;
}

/* ===== 輸入欄位互動 ===== */
const qtyKeypad = document.getElementById('qtyKeypad');
const btnQtyKeypad = document.getElementById('btnQtyKeypad');
const qtyPadMessage = document.getElementById('qtyPadMessage');
const saveStatus = document.getElementById('saveStatus');

function setKeypadOpen(open) {
  qtyKeypad.hidden = !open;
  btnQtyKeypad.setAttribute('aria-expanded', String(open));
  btnQtyKeypad.textContent = open ? '收合數字面板' : '開啟數字面板';
}
function goToQuantity() {
  qtyEl.focus();
  qtyEl.select();
  setKeypadOpen(true);
}
barcodeEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    goToQuantity();
  }
});
qtyEl.addEventListener('focus', () => setKeypadOpen(true));
qtyEl.addEventListener('click', () => setKeypadOpen(true));
barcodeEl.addEventListener('focus', () => setKeypadOpen(false));
btnQtyKeypad.addEventListener('click', () => {
  if (!qtyKeypad.hidden) setKeypadOpen(false);
  else goToQuantity();
});
// 點數字時維持欄位游標，讓掃描槍與觸控輸入可以共用。
qtyKeypad.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) e.preventDefault();
});
qtyKeypad.addEventListener('click', e => {
  const button = e.target.closest('button[data-pad]');
  if (!button) return;
  const action = button.dataset.pad;
  qtyPadMessage.textContent = '';
  if (action === 'close') { setKeypadOpen(false); btnQtyKeypad.focus(); return; }
  if (action === 'submit') { doSubmitLocal(); return; }
  if (submitInProgress) return;
  let value = qtyEl.value;
  let start = qtyEl.selectionStart ?? value.length;
  let end = qtyEl.selectionEnd ?? start;
  if (/^[0-9]$/.test(action)) {
    const next = value.slice(0, start) + action + value.slice(end);
    if (next.length > 10) { qtyPadMessage.textContent = '數量最多 10 碼。'; return; }
    value = next;
    start += 1;
  } else if (action === 'clear') { value = ''; start = 0; }
  else if (action === 'backspace') {
    const left = start === end ? Math.max(0, start - 1) : start;
    value = value.slice(0, left) + value.slice(end);
    start = left;
  } else if (action === 'plus' || action === 'minus') {
    const next = Math.max(1, Number(value || 0) + (action === 'plus' ? 1 : -1));
    if (next > 9999999999) { qtyPadMessage.textContent = '數量最多 10 碼。'; return; }
    value = String(next); start = value.length;
  }
  qtyEl.value = value;
  qtyEl.dispatchEvent(new Event('input', { bubbles: true }));
  qtyEl.focus();
  qtyEl.setSelectionRange(start, start);
});

qtyEl.addEventListener('keydown', e => {
  if (['.',' ',',','e','E','+','-'].includes(e.key)) e.preventDefault();
  if (e.key === 'Enter') {
    e.preventDefault();
    doSubmitLocal();
  }
});

qtyEl.addEventListener('input', () => {
  qtyEl.value = qtyEl.value.replace(/[^\d]/g,'').slice(0,10);
});

btnSubmit.addEventListener('click', doSubmitLocal);

/* ===== 新增本機紀錄 ===== */
let submitInProgress = false;
async function doSubmitLocal() {
  if (submitInProgress) return;
  const date    = invDateEl.value;
  const wh      = whEl.value.trim();
  const barcode = barcodeEl.value.trim();
  const qty     = parseInt(qtyEl.value.trim(), 10);

  if (!date || !wh || !barcode || !Number.isInteger(qty) || qty <= 0) {
    vibrateError();
    alert('請確認：盤點日、庫別、條碼、數量均不可空白，且數量需為正整數。');
    return;
  }

  const entry = {
    id: uuid(),
    date, wh, barcode,
    qty,
    createdAt: new Date().toISOString(),
    syncedAt: null
  };

  submitInProgress = true;
  btnSubmit.disabled = true;
  try {
    await addPending(entry);
  } catch (err) {
    saveStatus.textContent = '儲存失敗，資料已保留在欄位中，請重試。';
    vibrateError();
    return;
  } finally {
    submitInProgress = false;
    btnSubmit.disabled = false;
  }
  saveStatus.textContent = `已存入本機：${barcode}，數量 ${qty}。`;
  qtyPadMessage.textContent = '';
  setKeypadOpen(false);
  vibrateOk();

  barcodeEl.value = '';
  qtyEl.value = '';
  barcodeEl.focus();

  await renderRecent();
  await updateQueueStatus();
}

/* ===== 顯示最近 5 筆（依當前盤點日 + 庫別 + 搜尋條件） ===== */
async function renderRecent() {
  const curDate = invDateEl.value;
  const curWh   = whEl.value.trim();
  const filterBarcode = searchBarcodeEl.value.trim();

  const all = await getAllPending();
  let list = all.filter(x => x.date === curDate && x.wh === curWh);

  if (filterBarcode) {
    const key = filterBarcode.toUpperCase();
    list = list.filter(x => String(x.barcode).toUpperCase().includes(key));
  }

  list.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  list = list.slice(0,5);

  recentEl.innerHTML = '';

  if (!list.length) {
    recentEl.innerHTML = '<div class="hint small">目前沒有符合條件的本機紀錄。</div>';
    return;
  }

  list.forEach(r => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = r.id;

    const synced = !!r.syncedAt;
    const stateText = synced ? '已同步' : '尚未同步';
    const stateClass = synced ? '' : 'unsynced';

    row.innerHTML = `
      <div class="info">
        <div class="barcode">${r.barcode}</div>
        <div class="meta">
          <span>${r.date} ｜ ${r.wh}</span>
          <span class="badge ${stateClass}">${stateText}</span>
        </div>
      </div>
      <div class="ctrls">
        <button class="icon-btn btn-minus">-</button>
        <div class="qty-box"><span class="qty">${r.qty}</span></div>
        <button class="icon-btn btn-plus">+</button>
        <button class="icon-btn btn-del">🗑</button>
      </div>
    `;
    recentEl.appendChild(row);
  });
}

/* ===== 最近清單：刪除 / 數量 +/- ===== */
recentEl.addEventListener('click', async e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.closest('.btn-del')) {
    if (confirm('只會刪除本機暫存紀錄，不會影響試算表。確定刪除？')) {
      await removePending(id);
      await renderRecent();
      await updateQueueStatus();
    }
    return;
  }

  if (e.target.closest('.btn-plus')) {
    await changeQty(id, +1);
    return;
  }

  if (e.target.closest('.btn-minus')) {
    await changeQty(id, -1);
    return;
  }
});

async function changeQty(id, delta) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const obj = req.result;
      if (!obj) { resolve(); return; }
      let q = (obj.qty || 0) + delta;
      if (q < 1) q = 1;
      obj.qty = q;
      obj.syncedAt = null; // 調整後需重新同步
      store.put(obj);
    };
    req.onerror = e => reject(e.target.error);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });

  await renderRecent();
  await updateQueueStatus();
}

/* 搜尋條碼 */
searchBarcodeEl.addEventListener('input', () => {
  renderRecent();
});
btnSearchReset.addEventListener('click', () => {
  searchBarcodeEl.value = '';
  renderRecent();
});

/* ===== 同步到伺服器 ===== */
async function syncNow() {
  if (!navigator.onLine) {
    vibrateError();
    alert('目前為離線狀態，無法同步。');
    return;
  }
  const all = await getAllPending();
  const unsynced = all.filter(d => !d.syncedAt);
  if (!unsynced.length) {
    alert('沒有待同步資料。');
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: API_SECRET,
        action: 'sync',
        entries: unsynced.map(x => ({
          clientId: x.id,
          date: x.date,
          wh: x.wh,
          barcode: x.barcode,
          qty: x.qty,
          clientTime: x.createdAt
        }))
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '同步失敗');

    const okIds = (json.results || []).filter(r => r.status === 'ok').map(r => r.clientId);

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      okIds.forEach(id => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const obj = getReq.result;
          if (obj) {
            obj.syncedAt = new Date().toISOString();
            store.put(obj);
          }
        };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });

    vibrateOk();
    alert(`同步完成，共成功 ${okIds.length} 筆。`);
    await renderRecent();
    await updateQueueStatus();
  } catch (err) {
    vibrateError();
    alert('同步失敗：' + err.message);
  }
}

btnSync.addEventListener('click', syncNow);

/* ===== 清空試算表（指定日期 + 庫別） ===== */
async function clearSheetOnServer() {
  if (!navigator.onLine) {
    vibrateError();
    alert('目前為離線狀態，無法清空試算表。');
    return;
  }
  const d = invDateEl.value;
  const w = whEl.value.trim();
  if (!d || !w) {
    vibrateError();
    alert('請先設定盤點日與庫別');
    return;
  }
  if (!confirm(`確定要清空試算表中\n日期：${d}\n庫別：${w}\n的所有盤點紀錄？`)) {
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: API_SECRET,
        action: 'clearSheet',
        date: d,
        wh: w
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '清空失敗');

    // 本機暫存中同日期+庫別的資料也一併刪除
    const all = await getAllPending();
    const db = await openDB();
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE_NAME,'readwrite');
      const store = tx.objectStore(STORE_NAME);
      all.forEach(x=>{
        if (x.date === d && x.wh === w) store.delete(x.id);
      });
      tx.oncomplete = ()=>resolve();
      tx.onerror = e=>reject(e.target.error);
    });

    vibrateOk();
    alert(`已清空試算表：刪除 ${json.removed} 筆資料。`);
    await renderRecent();
    await updateQueueStatus();
  } catch (err) {
    vibrateError();
    alert('清空失敗：' + err.message);
  }
}

btnClearSheet.addEventListener('click', clearSheetOnServer);

/* ===== 寄出 CSV ===== */
function normalizeEmailList(input) {
  const s = String(input || '').trim().replace(/[；;、\s]+/g, ',');
  const arr = s.split(',').map(e => e.trim()).filter(Boolean);
  return arr.join(',');
}
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

btnExport.addEventListener('click', async () => {
  if (!navigator.onLine) {
    vibrateError();
    alert('目前為離線狀態，無法寄出 Email。');
    return;
  }
  const raw = emailEl.value;
  const normalized = normalizeEmailList(raw);
  if (!normalized) {
    vibrateError();
    alert('請先輸入收件者 Email');
    return;
  }
  const list = normalized.split(',');
  if (list.some(e => !isValidEmail(e))) {
    vibrateError();
    alert('收件者 Email 格式不正確：' + normalized);
    return;
  }
  const d = invDateEl.value;
  const w = whEl.value.trim();
  if (!d || !w) {
    vibrateError();
    alert('請先輸入盤點日與庫別');
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: API_SECRET,
        action: 'exportCsv',
        date: d,
        wh: w,
        email: normalized
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '匯出失敗');

    vibrateOk();
    alert(`已寄出 .csv 到：${normalized}\n筆數：${json.rows}\n檔名：${json.fileName}`);
  } catch (err) {
    vibrateError();
    alert('匯出失敗：' + err.message);
  }
});

/* ===== 啟動時載入狀態 ===== */
(async function init() {
  setNetStatus();
  await renderRecent();
  await updateQueueStatus();
})();

/* 網路狀態變更 */
window.addEventListener('online', async () => {
  setNetStatus();
  await updateQueueStatus();
});
window.addEventListener('offline', () => {
  setNetStatus();
});

/* Service Worker（PWA） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

