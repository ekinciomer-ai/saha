// =============================================================================
// core-sync.js — SHAMS-1 Saha Takip · Faz 1, Modül #1 (storage/senkron katmanı)
// =============================================================================
// ÖNEMLİ — BU DOSYA KLASİK (NON-MODULE) SCRIPT OLARAK YAZILMIŞTIR, ES module
// DEĞİL. Sebebi: module tipi script etiketi tarayıcıda her zaman ERTELENEREK
// (deferred) çalışır — index.html'in asıl script etiketinden SONRA. Bu
// dosyanın, index.html'deki eski `let BACKEND/GH/POOL/MEM/FBDB/UPCOUNT/UPLAST`
// tanımlarından ÖNCE çalışması şart (yoksa bu değişkenler `var` yerine `let`
// ile tekrar tanımlanır ve bu dosyadaki tanımları gölgede bırakır).
// Bu yüzden bu dosya index.html'e ayrı, harici bir dosya olarak, script
// etiketiyle (src="core-sync.js") ve asıl büyük script bloğundan ÖNCE
// eklenmelidir. Faz 2'de gerçek bir build sistemi (Vite) devreye girince
// ES module'e çevrilecek.
//
// KAPSAM: 5 backend (Firebase Realtime DB / GitHub havuzu / window.storage /
// localStorage / bellek-içi), sget/sset/sdel/slist/sgetAll, Firebase init,
// GitHub yedek push/pull. Her fonksiyonun mantığı index.html'deki orijinaliyle
// (satır ~1058-1198) birebir aynıdır — davranış değişikliği YOKTUR, sadece
// konum değişti + aşağıdaki tek iyileştirme eklendi.
//
// YAPILAN TEK İYİLEŞTİRME — zone artık (opsiyonel) PARAMETRE:
//   Eskiden her depolama fonksiyonu (sget/sset/.../fbPath), "hangi bölge"
//   sorusunu çözmek için global `TRZ` değişkenini DOLAYLI olarak okuyordu.
//   Bazı yerlerde (özellikle ensureHeavy()) "diğer bölgenin" verisini okumak
//   için TRZ GEÇİCİ OLARAK flip edilip geri alınıyordu:
//       var _curZ=TRZ; TRZ='tr3'; /* oku */ TRZ=_curZ;
//   Flip ile restore arasına bir hata/await noktası girerse TRZ yanlış
//   değerde asılı kalır — TR-1/TR-3 veri kirlenmesi vakasının kök nedeni tam
//   olarak bu. BURADA TRZ KALDIRILMADI (index.html'de hâlâ var ve başka
//   onlarca yerde kullanılıyor) — ama her fonksiyona artık opsiyonel bir
//   `zone` parametresi eklendi: verilmezse DAVRANIŞ ESKİSİYLE BİREBİR AYNI
//   (TRZ okunur), verilirse TRZ'ye hiç dokunmadan o bölge sorgulanabilir.
//   Yani riskli "flip-and-restore" paterni artık ZORUNLU DEĞİL — ama bu
//   dosya onu kaldırmıyor, sadece alternatifini sunuyor. ensureHeavy()'nin
//   kendisi bu dosyaya taşınmadı (bkz. proje dokümanı §8.3) — o hâlâ
//   index.html'de, TRZ-flip ile çalışmaya devam ediyor. Onun yeni
//   `sgetAllValuesBothZones` ile değiştirilmesi AYRI bir adım.
//
// index.html'de SİLİNMESİ GEREKEN karşılık gelen eski tanımlar (bu dosya
// onların yerini alıyor): FBCONFIG, `let FBDB=null;`, loadScript, fbInit,
// SHARED_KEYS, _isShared, fbPath, `let ROLE=...,BACKEND=...,POOL=...,
// MEM=...,GH=...,poolSha=...,pushTimer=...` satırındaki BACKEND/POOL/MEM/GH/
// poolSha/pushTimer (ROLE/POLL/lastAct KALACAK — bunlar core-sync değil),
// `let UPCOUNT=0,UPLAST=0;`, ghUrl, ghHeaders, b64enc, b64dec, ghStat,
// ghPull, ghBuildPool, ghPushOnce, ghPush, schedulePush, sget, _ssetRaw,
// showSaveError, sset, sdel, slist, sgetAll, loadGhCfg, saveGhCfg,
// chooseBackend, persistLabel. (nowt() KALACAK — başka yerlerde de
// kullanılıyor, core-sync ona sadece erişiyor.)
// =============================================================================

var FBCONFIG = {
  apiKey: "AIzaSyBvM-noMGWqFh4KzG11zRpr8RSF-8ROqX8",
  authDomain: "shams1-saha.firebaseapp.com",
  databaseURL: "https://shams1-saha-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shams1-saha",
  storageBucket: "shams1-saha.firebasestorage.app",
  messagingSenderId: "38125778484",
  appId: "1:38125778484:web:0bbda1385d55913d77fc61"
};

// ----- durum (eskiden index.html'de dağınık `let` idi, artık gerçek global `var`) -----
var BACKEND = 'mem';   // 'fb' | 'gh' | 'ws' | 'ls' | 'mem'
var POOL = {};
var MEM = {};
var GH = null;
var poolSha = null;
var pushTimer = null;
var FBDB = null;
var UPCOUNT = 0, UPLAST = 0;

// Paylaşılan koleksiyonlar: bölgeden bağımsız, her zaman shams1tr1/ altında
// yaşarlar (orijinaldeki SHARED_KEYS ile birebir aynı). index.html'deki
// 'shams1ortak' göç fonksiyonu bu listeyi hâlâ doğrudan okuyor — bu yüzden
// gerçek bir global olarak kalmalı.
var SHARED_KEYS = ['team', 'team_del', 'wage', 'fx', 'wx', 'parac', 'pj', 'pjg', 'pjz',
  'pj2x', 'pja', 'pjag', 'pjp', 'pjpg', 'tr2data', 'tr2log', 'mqlog'];

function _isShared(k) {
  var b = String(k).split(':')[0];
  return SHARED_KEYS.indexOf(b) >= 0;
}

/**
 * Firebase path üretir. `zone` opsiyonel — verilmezse (eskisi gibi) global
 * TRZ okunur, davranış birebir korunur. Verilirse TRZ'ye dokunulmadan o
 * bölge sorgulanır.
 */
function fbPath(k, zone) {
  if (zone === undefined || zone === null) zone = TRZ;
  var base = _isShared(k) ? 'shams1tr1/' : (zone === 'tr3' ? 'shams1tr3/' : 'shams1tr1/');
  return base + String(k).replace(/[.#$\[\]]/g, '_').replace(/:/g, '/');
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const x = document.createElement('script');
    x.src = src; x.onload = res; x.onerror = rej;
    document.head.appendChild(x);
  });
}

async function fbInit() {
  if (!FBCONFIG || !FBCONFIG.databaseURL) return false;
  if (FBDB) return true;
  try {
    if (!window.firebase) {
      await Promise.race([
        (async () => {
          await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
          await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js');
          await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js');
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('fb-timeout')), 7000))
      ]);
    }
    firebase.initializeApp(FBCONFIG);
    try {
      if (firebase.auth && !firebase.auth().currentUser) {
        await firebase.auth().signInAnonymously();
      }
    } catch (e) {
      console.warn('Firebase anonim oturum açılamadı (Authentication > Anonymous kapalı olabilir) — açık kuralla devam:', e && (e.code || e.message));
    }
    FBDB = firebase.database();
    return true;
  } catch (e) {
    return false;
  }
}

async function chooseBackend() {
  await loadGhCfg();
  if (await fbInit()) { BACKEND = 'fb'; return; }
  if (GH && GH.owner && GH.repo && GH.path && GH.token) {
    try { await ghPull(); BACKEND = 'gh'; return; } catch (e) {}
  }
  if (window.storage) { BACKEND = 'ws'; return; }
  let _ls = false;
  try { localStorage.setItem('shams1:_t', '1'); localStorage.removeItem('shams1:_t'); _ls = true; } catch (e) {}
  BACKEND = _ls ? 'ls' : 'mem';
}

// ----------------------------- okuma / yazma --------------------------------

async function sget(k, zone) {
  if (BACKEND === 'fb') {
    try {
      const sn = await FBDB.ref(fbPath(k, zone)).once('value');
      return sn.exists() ? sn.val() : null;
    } catch (e) { return null; }
  }
  if (BACKEND === 'gh') return (k in POOL) ? POOL[k] : null;
  if (BACKEND === 'ws') {
    try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; }
    catch (e) { return null; }
  }
  if (BACKEND === 'ls') {
    try { const v = localStorage.getItem('shams1:' + k); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  return (k in MEM) ? MEM[k] : null;
}

async function _ssetRaw(k, v, zone) {
  if (BACKEND === 'fb') {
    try { await FBDB.ref(fbPath(k, zone)).set(v); } catch (e) { return false; }
    return true;
  }
  if (BACKEND === 'gh') {
    POOL[k] = v;
    try { clearTimeout(pushTimer); await ghPush(); }
    catch (e) { try { console.error('[gh push]', e); } catch (_e) {} return false; }
    return true;
  }
  if (BACKEND === 'ws') {
    try { await window.storage.set(k, JSON.stringify(v), true); } catch (e) { return false; }
    if (GH && GH.autosync !== false) schedulePush();
    return true;
  }
  if (BACKEND === 'ls') {
    try { localStorage.setItem('shams1:' + k, JSON.stringify(v)); } catch (e) { return false; }
    if (GH && GH.autosync !== false) schedulePush();
    return true;
  }
  MEM[k] = v;
  return true;
}

function showSaveError(k) {
  try {
    let b = document.getElementById('saveerrbar');
    if (!b) {
      b = document.createElement('div');
      b.id = 'saveerrbar';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 14px;font:13px/1.4 var(--sans,-apple-system,sans-serif);font-weight:700;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.appendChild(b);
    }
    b.innerHTML = '⚠ KAYDETME BAŞARISIZ OLDU — internet bağlantını kontrol et, tekrar dene! <span style="text-decoration:underline;cursor:pointer;margin-left:8px" onclick="document.getElementById(\'saveerrbar\').remove()">kapat</span>';
  } catch (e) {}
}

async function sset(k, v, zone) {
  if (window.RO) return null;
  const r = await _ssetRaw(k, v, zone);
  if (r === false) {
    showSaveError(k);
    try { console.error('[sset] save failed for key:', k); } catch (e) {}
    return r;
  }
  if (k !== 'upc' && k !== 'uplast') {
    UPCOUNT = (UPCOUNT || 0) + 1;
    UPLAST = Date.now();
    await _ssetRaw('upc', UPCOUNT);
    await _ssetRaw('uplast', UPLAST);
    if (typeof renderUpBadge === 'function') renderUpBadge();
  }
  return r;
}

async function sdel(k, zone) {
  if (BACKEND === 'fb') {
    try { await FBDB.ref(fbPath(k, zone)).remove(); } catch (e) {}
    return;
  }
  if (BACKEND === 'gh') { delete POOL[k]; schedulePush(); return; }
  if (BACKEND === 'ws') {
    try { await window.storage.delete(k, true); } catch (e) {}
    if (GH && GH.autosync !== false) schedulePush();
    return;
  }
  if (BACKEND === 'ls') {
    try { localStorage.removeItem('shams1:' + k); } catch (e) {}
    if (GH && GH.autosync !== false) schedulePush();
    return;
  }
  delete MEM[k];
}

async function slist(p, zone) {
  if (BACKEND === 'fb') {
    try {
      const pp = fbPath(p.replace(/:$/, ''), zone);
      const sn = await FBDB.ref(pp).once('value');
      const o = []; sn.forEach(c => { o.push(p + c.key); });
      return o;
    } catch (e) { return []; }
  }
  if (BACKEND === 'gh') return Object.keys(POOL).filter(k => k.startsWith(p));
  if (BACKEND === 'ws') {
    try { const r = await window.storage.list(p, true); return (r && r.keys) || []; }
    catch (e) { return []; }
  }
  if (BACKEND === 'ls') {
    try {
      const o = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.indexOf('shams1:' + p) === 0) o.push(kk.slice(7));
      }
      return o;
    } catch (e) { return []; }
  }
  return Object.keys(MEM).filter(k => k.startsWith(p));
}

/** Toplu okuma: bir önek altındaki tüm kayıtları TEK istekte getirir. */
async function sgetAll(p, zone) {
  if (BACKEND === 'fb') {
    try {
      const sn = await FBDB.ref(fbPath(p.replace(/:$/, ''), zone)).once('value');
      const o = {}; sn.forEach(c => { o[p + c.key] = c.val(); });
      return o;
    } catch (e) { return {}; }
  }
  if (BACKEND === 'gh') {
    const o = {}; for (const k in POOL) if (k.indexOf(p) === 0) o[k] = POOL[k];
    return o;
  }
  if (BACKEND === 'ws') {
    const o = {};
    try {
      const r = await window.storage.list(p, true);
      const keys = (r && r.keys) || [];
      await Promise.all(keys.map(async k => {
        try { const g = await window.storage.get(k, true); if (g) o[k] = JSON.parse(g.value); }
        catch (e) {}
      }));
    } catch (e) {}
    return o;
  }
  if (BACKEND === 'ls') {
    const o = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.indexOf('shams1:' + p) === 0) {
          const v = localStorage.getItem(kk);
          if (v) o[kk.slice(7)] = JSON.parse(v);
        }
      }
    } catch (e) {}
    return o;
  }
  const o = {}; for (const k in MEM) if (k.indexOf(p) === 0) o[k] = MEM[k];
  return o;
}

// ------------------------- yeni primitif (ileriye dönük) --------------------
// Henüz hiçbir çağıran yok — ensureHeavy()'nin TRZ-flip bloklarını değiştirmek
// için hazırlanan, state'siz bir yardımcı. Bkz. dosya başındaki not.

async function sgetAllValues(prefix, zone) {
  const obj = await sgetAll(prefix, zone);
  return Object.values(obj || {}).filter(Boolean);
}

async function sgetAllValuesBothZones(prefix, zone, otherZone) {
  if (zone === undefined || zone === null) zone = TRZ;
  if (!otherZone) otherZone = (zone === 'tr3' ? 'tr1' : 'tr3');
  let a = [], b = [];
  try { a = await sgetAllValues(prefix, zone); } catch (e) {}
  try { b = await sgetAllValues(prefix, otherZone); } catch (e) {}
  return a.concat(b);
}

// --------------------------- GitHub yedek havuzu -----------------------------

function ghUrl() {
  return 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo +
    '/contents/' + encodeURIComponent(GH.path).replace(/%2F/g, '/');
}
function ghHeaders() {
  return {
    'Authorization': 'token ' + GH.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}
function b64enc(x) { return btoa(unescape(encodeURIComponent(x))); }
function b64dec(x) { return decodeURIComponent(escape(atob((x || '').replace(/\s/g, '')))); }

function ghStat(m) {
  const e = document.getElementById('ghstat'); if (e) e.textContent = m;
  const s = document.getElementById('status'); if (s && BACKEND === 'gh') s.textContent = m;
}

async function ghPull() {
  if (!GH || !GH.token) throw 'cfg';
  const r = await fetch(ghUrl() + '?ref=' + encodeURIComponent(GH.branch || 'main') + '&t=' + Date.now(), { headers: ghHeaders() });
  if (r.status === 404) { POOL = {}; poolSha = null; return false; }
  if (!r.ok) throw 'HTTP ' + r.status;
  const j = await r.json();
  poolSha = j.sha;
  POOL = JSON.parse(b64dec(j.content) || '{}');
  return true;
}

async function ghBuildPool() {
  if (BACKEND === 'gh') return POOL;
  const pool = {};
  for (const pre of ['tr1g:', 'log:', 'tr1m:']) for (const k of await slist(pre)) pool[k] = await sget(k);
  pool['mpct'] = await sget('mpct');
  pool['targets'] = await sget('targets');
  return pool;
}

async function ghPushOnce() {
  if (!GH || !GH.token) return;
  let sha = poolSha;
  try {
    const r = await fetch(ghUrl() + '?ref=' + encodeURIComponent(GH.branch || 'main') + '&t=' + Date.now(), { headers: ghHeaders() });
    if (r.ok) {
      const j = await r.json(); sha = j.sha;
      if (BACKEND === 'gh') {
        const rem = JSON.parse(b64dec(j.content) || '{}');
        for (const k in rem) if (!(k in POOL)) POOL[k] = rem[k];
      }
    } else if (r.status === 404) sha = null;
  } catch (e) {}
  const pool = await ghBuildPool();
  pool._updated = Date.now();
  const body = {
    message: 'saha veri ' + new Date().toISOString().slice(0, 16),
    content: b64enc(JSON.stringify(pool)),
    branch: GH.branch || 'main'
  };
  if (sha) body.sha = sha;
  const pr = await fetch(ghUrl(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!pr.ok) { const err = new Error('PUT ' + pr.status); err.status = pr.status; throw err; }
  const j = await pr.json();
  poolSha = j.content && j.content.sha;
  ghStat('● GitHub havuz · ' + nowt());
}

async function ghPush() {
  if (!GH || !GH.token) return;
  const MAX = 4;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try { await ghPushOnce(); return; }
    catch (e) {
      if (attempt === MAX - 1) throw e;
      // Çakışma (başka bir cihaz aynı anda kaydetti) veya geçici ağ hatası —
      // kısa bekleyip taze sha ile tekrar dene.
      await new Promise(res => setTimeout(res, 300 + Math.floor(Math.random() * 400) + (attempt * 400)));
    }
  }
}

function schedulePush() {
  if (!GH || !GH.token || GH.autosync === false) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => ghPush().catch(() => ghStat('GitHub yazma hatası')), 1600);
}

async function loadGhCfg() {
  try {
    if (window.storage) {
      const r = await window.storage.get('ghcfg', true);
      if (r) GH = JSON.parse(r.value);
    }
  } catch (e) {}
  if (!GH) {
    try { const j = localStorage.getItem('ghcfg'); if (j) GH = JSON.parse(j); } catch (e) {}
  }
}

async function saveGhCfg() {
  try { if (window.storage) await window.storage.set('ghcfg', JSON.stringify(GH), true); } catch (e) {}
  try { localStorage.setItem('ghcfg', JSON.stringify(GH)); } catch (e) {}
}

function persistLabel() {
  return BACKEND === 'fb' ? '● Kalıcı · Bulut (her cihaz ortak)'
    : BACKEND === 'gh' ? '● Kalıcı · GitHub havuz (ekip ortak)'
    : BACKEND === 'ws' ? '● Kalıcı · bu tarayıcı (Claude)'
    : BACKEND === 'ls' ? '● Kalıcı · bu cihaz (yerel)'
    : '⚠ GEÇİCİ — kayıt YOK';
}
