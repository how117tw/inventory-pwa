/* ===== 設定：請改成你的 API URL 與密鑰 ===== */
const API_URL    = 'https://script.google.com/macros/s/AKfycbxylbWYd385ziInsNEZU8qffWG0fpxTjFwq_ZuXXqzfvVSwEsY7uF5kIiWwXl2z8BPZxQ/exec'; // ★貼上你的 Web App URL
const API_SECRET = 'Tgg_45499448_Tmg'; // ★必須跟 Code.gs 的 API_SECRET 一樣
const DB_NAME    = 'inventoryPWA';
const DB_VERSION = 1;
const STORE_NAME = 'pending';  // 排隊中的資料（尚未同步或已同步）

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
    req.onerror   = e => reject(e.target.error);
  });
  return dbPromise;
}

async function addPending(entry){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getAllPending(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME,'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.index('byCreated').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function removePending(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/* ===== 工具 ===== */
function uuid() {
  return 'L' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2,8);
}
function vibrateOk(){ if(navigator.vibrate) navigator.vibrate(20); }
function vibrateError(){ if(navigator.vibrate) navigator.vibrate([40,30,40]); }

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

async function updateQueueStatus(){
  const data = await getAllPending();
  const unsynced = data.filter(d => !d.syncedAt);
  const el = document.getElementById('queueStatus');
  if (unsynced.length === 0) {
    el.style.display = 'none';
  } else {
    el.style.display = 'inline-block';
    el.textContent = `尚有 ${unsynced.length} 筆待同步`;
  }
}

/* ===== UI DOM ===== */
const invDateEl = document.getElementById('invDate');
const whEl      = document.getElementById('warehouse');
const barcodeEl = document.getElementById('barcode');
const qtyEl     = document.getElementById('qty');
const recentEl  = document.getElementById('recent');

/* ===== 初始化 日期與庫別（從 localStorage） ===== */
(function initHeader(){
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = String(today.getMonth()+1).padStart(2,'0');
  const dd   = String(today.getDate()).padStart(2,'0');
  invDateEl.value = localStorage.getItem('invDate') || `${yyyy}-${mm}-${dd}`;
  whEl.value      = localStorage.getItem('warehouse') || '';

  invDateEl.addEventListener('change', () => {
    localStorage.setItem('invDate', invDateEl.value);
  });
  whEl.addEventListener('input', () => {
    whEl.value = whEl.value.toUpperCase().replace(/[^A-Z0-9\-]/g,'').slice(0,5);
    localStorage.setItem('warehouse', whEl.value);
  });
})();

/* ===== 條碼欄位：TAB 由瀏覽器自行跳欄，Enter 另外支援 ===== */
barcodeEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    qtyEl.focus();
    qtyEl.select();
  }
});

/* ===== 數量欄位只接受數字 + Enter 送出 ===== */
qtyEl.addEventListener('keydown', e => {
  if (['.',' ',',','e','E','+','-'].includes(e.key)) e.preventDefault();
  if (e.key === 'Enter') { e.preventDefault(); doSubmitLocal(); }
});
qtyEl.addEventListener('input', () => {
  qtyEl.value = qtyEl.value.replace(/[^\d]/g,'').slice(0,10);
});

document.getElementById('btnSubmit').addEventListener('click', doSubmitLocal);

/* ===== 在本機新增一筆紀錄（不直接上傳） ===== */
async function doSubmitLocal(){
  const date    = invDateEl.value;
  const wh      = whEl.value.trim();
  const barcode = barcodeEl.value.trim();
  const qty     = parseInt(qtyEl.value.trim(),10);

  if (!date || !wh || !barcode || !Number.isInteger(qty) || qty <= 0) {
    vibrateError();
    alert('請確認：盤點日、庫別、條碼、數量均不可空白，且數量需為正整數。');
    return;
  }

  const entry = {
    id: uuid(),
    date, wh, barcode, qty,
    createdAt: new Date().toISOString(),
    syncedAt: null
  };

  await addPending(entry);
  vibrateOk();
  barcodeEl.value = '';
  qtyEl.value = '';
  barcodeEl.focus();

  await renderRecent();
  await updateQueueStatus();
}

/* ===== 最近五筆畫面（只看本機 DB） ===== */
async function renderRecent(){
  const data = await getAllPending();
  // 依建立時間排序（新→舊），取前 5 筆
  data.sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
  const rows = data.slice(0,5);

  recentEl.innerHTML = '';
  if (!rows.length) {
    recentEl.innerHTML = '<div class="muted">目前沒有本機紀錄。</div>';
    return;
  }

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = r.id;

    const synced = !!r.syncedAt;
    const stateText = synced ? '已同步' : '尚未同步';
    const stateClass = synced ? '' : 'unsynced';

    row.innerHTML = `
      <div class="info">
        <div>
          <div class="barcode">${r.barcode}</div>
          <div class="meta">
            ${r.date} ｜ ${r.wh}
            <span class="badge ${stateClass}">${stateText}</span>
          </div>
        </div>
      </div>
      <div class="ctrls">
        <div class="qty-box"><span class="qty">${r.qty}</span></div>
        <button class="del btn-del">🗑</button>
      </div>
    `;
    recentEl.appendChild(row);
  });
}

/* 刪除本機某筆（暫存，不回寫伺服器） */
recentEl.addEventListener('click', async e => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (e.target.closest('.btn-del')) {
    if (confirm('只會刪除本機暫存紀錄，不會影響試算表。確定刪除？')) {
      await removePending(row.dataset.id);
      await renderRecent();
      await updateQueueStatus();
    }
  }
});

/* ===== 同步到伺服器 ===== */
async function syncNow(){
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
      method:'POST',
      headers:{'Content-Type':'application/json'},
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

    // 把成功的標記為 syncedAt
    const okIds = (json.results || []).filter(r=>r.status==='ok').map(r=>r.clientId);
    const db = await openDB();
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE_NAME,'readwrite');
      const store = tx.objectStore(STORE_NAME);
      okIds.forEach(id=>{
        const getReq = store.get(id);
        getReq.onsuccess = ()=>{
          const obj = getReq.result;
          if (obj) {
            obj.syncedAt = new Date().toISOString();
            store.put(obj);
          }
        };
      });
      tx.oncomplete = ()=>resolve();
      tx.onerror    = e=>reject(e.target.error);
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

document.getElementById('btnSync').addEventListener('click', syncNow);

/* 網路恢復時自動嘗試同步一次 */
window.addEventListener('online', async () => {
  setNetStatus();
  await updateQueueStatus();
  syncNow(); // 如不要自動同步可註解掉
});
window.addEventListener('offline', () => {
  setNetStatus();
});

/* ===== 寄 CSV ===== */
function normalizeEmailList(input){
  const s = String(input || '').trim().replace(/[；;、\s]+/g, ',');
  const arr = s.split(',').map(e => e.trim()).filter(Boolean);
  return arr.join(',');
}
function isValidEmail(email){
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

document.getElementById('btnExport').addEventListener('click', async () => {
  if (!navigator.onLine) {
    vibrateError();
    alert('目前為離線狀態，無法寄出 Email。');
    return;
  }
  const raw = document.getElementById('email').value;
  const normalized = normalizeEmailList(raw);
  if(!normalized){
    vibrateError();
    alert('請先輸入收件者 Email'); 
    return;
  }
  const list = normalized.split(',');
  if(list.some(e => !isValidEmail(e))){
    vibrateError();
    alert('收件者 Email 格式不正確：' + normalized);
    return;
  }
  const d = invDateEl.value;
  const w = whEl.value.trim();
  if(!d || !w){
    vibrateError();
    alert('請先輸入盤點日與庫別');
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
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

/* ===== 啟動時載入本機資料與狀態 ===== */
(async function init(){
  setNetStatus();
  await renderRecent();
  await updateQueueStatus();
})();

/* 登記 service worker（PWA 離線） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

