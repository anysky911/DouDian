// ==UserScript==
// @name         抖店检查V1.1.0
// @namespace    anysky911.doudian.check
// @version      1.1.0
// @description  选择平台店铺后，按可设置的频率逐条搜索 Excel 商品标题，将结果写入测试结果列并保存。
// @homepageURL  https://github.com/anysky911/DouDian
// @downloadURL  https://raw.githubusercontent.com/anysky911/DouDian/main/doudian-check.user.js
// @updateURL    https://raw.githubusercontent.com/anysky911/DouDian/main/doudian-check.user.js
// @match        https://www.erp321.com/epaas*
// @match        https://erp321.com/epaas*
// @match        https://goods.scm121.com/manage/goods/onlineStoreGoods*
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

/* 使用：在店铺商品管理（极速版）选好平台、店铺、上架状态等条件，
 * 选择 D:\work\影刀\缓存 中的 .xlsx，设置检测间隔，点击开始。
 * 有商品/无商品仅表示当前筛选条件下的标题搜索结果，不代表跨店同款判定。
 * 文件选择器由浏览器管理，首次请手动进入缓存目录。支持原文件保存及下载副本。
 * 后续版本递增 @version，保持 namespace、文件名、更新地址不变。
 * XLSX 仅替换结果单元格的 XML；其余 ZIP 条目原样保留。JSZip 为 MIT 许可。
 */
(() => {
  'use strict';
  const VERSION = '1.1.0', CHANNEL = 'doudian-check-1', NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const clean = x => String(x ?? '').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = e => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const query = s => document.querySelector(s);
  const all = s => [...document.querySelectorAll(s)];
  const isGoods = location.hostname === 'goods.scm121.com';
  const embedded = window.top !== window;
  const xml = text => {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Excel XML 无法解析');
    return d;
  };
  const tags = (n, name) => [...n.getElementsByTagNameNS('*', name)];
  const column = ref => (ref.match(/^[A-Z]+/) || [''])[0];
  const columnNo = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const cellText = (cell, strings) => {
    if (!cell) return '';
    if (cell.getAttribute('t') === 'inlineStr') return tags(cell, 't').map(x => x.textContent).join('');
    const v = tags(cell, 'v')[0]?.textContent || '';
    return cell.getAttribute('t') === 's' ? strings[Number(v)] || '' : v;
  };

  // Worker runs inside the actual cross-origin goods iframe. It only operates the search UI.
  let locked = false, baseline = '', shield, busyQuery = false;
  function form() {
    const f = query('#shopGoodsImportQuery');
    if (!visible(f)) throw new Error('请打开店铺商品管理（极速版），并保持该页面可见');
    return f;
  }
  function fingerprint() {
    return [...form().querySelectorAll('input')].filter(e => e.id !== 'shopGoodsImportQuery_itemName')
      .map(e => [e.id || e.name || e.placeholder, e.value, e.checked]).concat(
        [...form().querySelectorAll('.ant-select-selection-item')].map(e => e.textContent)).map(x => JSON.stringify(x)).join('|');
  }
  function context() {
    form();
    const shop = query('#shopGoodsImportQuery_shopIds')?.value;
    if (!shop || !/已选[1-9]/.test(shop)) throw new Error('请先选择平台和店铺');
    const status = query('#shopGoodsImportQuery_enabledStatus')?.closest('.ant-select')?.textContent || '全部状态';
    return `${shop}；${clean(status)}；沿用页面所有筛选条件`;
  }
  function setLock(value) {
    if (value) {
      context(); baseline = fingerprint();
      if (!shield) {
        shield = document.createElement('div');
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(255,255,255,.04);cursor:wait';
        shield.title = '批量检测中，请先暂停后修改筛选条件';
        document.body.append(shield);
      }
      shield.style.display = 'block';
    } else if (shield) shield.style.display = 'none';
    locked = value;
  }
  document.addEventListener('keydown', e => { if (locked && e.isTrusted && !e.composedPath().some(n => n.id === 'dd-check-panel')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  function resultState() {
    const table = all('.art-table').find(visible);
    if (!table) return null;
    const countText = all('.ant-pagination-total-text').filter(visible).map(e => e.textContent);
    if (countText.length !== 1) return null;
    const m = countText[0].match(/共\s*([\d,]+)\s*条/);
    if (!m) return null;
    const count = Number(m[1].replace(/,/g, ''));
    const empty = [...table.querySelectorAll('.empty-tips')].some(e => visible(e) && /暂无店铺商品/.test(e.textContent));
    const rows = [...table.querySelectorAll('.art-table-body tbody tr')].filter(e => visible(e) && e.querySelectorAll('td').length > 1 && !e.textContent.includes('暂无店铺商品'));
    if ((count === 0 && empty) || (count > 0 && rows.length > 0 && !empty)) return { count, text: count ? `有商品（${count}条）` : '无商品' };
    return null;
  }
  function loading() { return all('.art-loading-indicator-wrapper,.ant-spin-spinning').some(visible); }
  async function checkTitle(title) {
    if (!locked || busyQuery) throw new Error('检测状态异常，请暂停后重新开始');
    if (fingerprint() !== baseline) throw new Error('筛选条件发生变化，请重新开始');
    if (loading()) throw new Error('页面仍在加载，请稍后重试');
    busyQuery = true;
    let observer;
    try {
      const input = query('#shopGoodsImportQuery_itemName');
      if (!input || !title) throw new Error('商品标题为空或搜索框不存在');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(120);
      const button = [...form().querySelectorAll('button')].find(e => e.textContent.replace(/\s/g, '') === '搜索');
      if (!button || button.disabled) throw new Error('找不到可用的搜索按钮');
      let sawLoading = false, error = '', stableSince = 0, last = '';
      const inspectNode = n => {
        if (n.nodeType !== 1) return;
        if (n.matches('.art-loading-indicator-wrapper,.ant-spin-spinning') || n.querySelector('.art-loading-indicator-wrapper,.ant-spin-spinning')) sawLoading = true;
        const errors = [n, ...n.querySelectorAll('.ant-message-error,.ant-notification-notice-error')];
        if (errors.some(e => e.matches('.ant-message-error,.ant-notification-notice-error'))) error = '页面提示错误，请检查网络、登录状态或权限';
      };
      observer = new MutationObserver(records => {
        for (const r of records) {
          for (const n of r.addedNodes) inspectNode(n);
          if (r.type === 'attributes' && (r.target.matches('.art-loading-indicator-wrapper,.ant-spin-spinning') || /ant-spin-spinning/.test(r.oldValue || ''))) sawLoading = true;
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      button.click();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(100);
        if (error) throw new Error(error);
        if (!input.isConnected || input.value !== title) throw new Error('页面或搜索标题发生变化');
        if (fingerprint() !== baseline) throw new Error('筛选条件发生变化');
        if (loading()) { sawLoading = true; stableSince = 0; continue; }
        const result = resultState();
        if (!sawLoading || !result) { stableSince = 0; continue; }
        if (!stableSince || last !== result.text) { stableSince = Date.now(); last = result.text; }
        if (Date.now() - stableSince >= 800) return result;
      }
      throw new Error('30秒超时或未确认本次搜索完成，未判定为无商品');
    } finally { observer?.disconnect(); busyQuery = false; }
  }
  async function worker(action, payload) {
    if (action === 'context') return context();
    if (action === 'lock') { setLock(true); return context(); }
    if (action === 'unlock') { setLock(false); return true; }
    if (action === 'check') return checkTitle(payload);
    throw new Error('不支持的操作');
  }
  if (isGoods && embedded) {
    window.addEventListener('message', async e => {
      if (e.source !== window.parent || !/^https:\/\/(www\.)?erp321\.com$/.test(e.origin)) return;
      const m = e.data;
      if (!m || m.channel !== CHANNEL || m.type !== 'request' || typeof m.id !== 'string') return;
      try { e.source.postMessage({ channel: CHANNEL, type: 'reply', id: m.id, value: await worker(m.action, m.payload) }, e.origin); }
      catch (err) { e.source.postMessage({ channel: CHANNEL, type: 'reply', id: m.id, error: err.message }, e.origin); }
    });
    return;
  }
  if (embedded) return;
  let activeFrame = null;
  async function rpc(action, payload) {
    if (isGoods) return worker(action, payload);
    const frame = action === 'unlock' && activeFrame ? activeFrame : query('#iframe-3108');
    if (!frame || (!visible(frame) && action !== 'unlock')) throw new Error('请打开店铺商品管理（极速版）标签');
    const origin = new URL(frame.src, location.href).origin;
    if (origin !== 'https://goods.scm121.com') throw new Error('商品页地址不匹配');
    if (action === 'lock') activeFrame = frame;
    const target = frame.contentWindow, id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(new Error('商品页未响应，请刷新聚水潭后重试（确认篡改猴允许内嵌页面运行）')), action === 'check' ? 35000 : 5000);
      function done(err, value) { clearTimeout(timeout); window.removeEventListener('message', listener); err ? reject(err) : resolve(value); }
      function listener(e) {
        const m = e.data;
        if (e.source === target && e.origin === origin && m?.channel === CHANNEL && m.type === 'reply' && m.id === id) done(m.error ? new Error(m.error) : null, m.value);
      }
      window.addEventListener('message', listener);
      target.postMessage({ channel: CHANNEL, type: 'request', id, action, payload }, origin);
    });
  }

  async function openWorkbook(file) {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx，请先用 Excel/WPS 将旧版 .xls 另存为 .xlsx');
    if (file.size > 30 * 1024 * 1024) throw new Error('文件超过30MB，请拆分后检测');
    const bytes = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(bytes);
    const read = async p => { const entry = zip.file(p); if (!entry) throw new Error(`Excel 缺少 ${p}`); return entry.async('string'); };
    const book = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels'));
    const strings = zip.file('xl/sharedStrings.xml') ? tags(xml(await read('xl/sharedStrings.xml')), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
    const sheets = [];
    for (const sheet of tags(book, 'sheet')) {
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = tags(rels, 'Relationship').find(r => r.getAttribute('Id') === id);
      if (!rel || rel.getAttribute('TargetMode') === 'External') continue;
      const target = rel.getAttribute('Target');
      const path = new URL(target, 'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1);
      const source = await read(path), doc = xml(source), rows = tags(doc, 'row');
      for (const header of rows.slice(0, 20)) {
        const cells = tags(header, 'c');
        const titles = cells.filter(c => clean(cellText(c, strings)) === '商品标题');
        const results = cells.filter(c => clean(cellText(c, strings)) === '测试结果');
        if (!titles.length) continue;
        if (titles.length !== 1 || results.length !== 1) throw new Error(`工作表「${sheet.getAttribute('name')}」必须有唯一的商品标题、测试结果列`);
        const titleCol = column(titles[0].getAttribute('r')), resultCol = column(results[0].getAttribute('r'));
        const items = rows.filter(r => Number(r.getAttribute('r')) > Number(header.getAttribute('r'))).map(r => {
          const cs = tags(r, 'c'), row = Number(r.getAttribute('r'));
          const title = clean(cellText(cs.find(c => column(c.getAttribute('r')) === titleCol), strings));
          const old = clean(cellText(cs.find(c => column(c.getAttribute('r')) === resultCol), strings));
          return { row, title, old, result: '' };
        }).filter(r => r.title);
        sheets.push({ name: sheet.getAttribute('name'), path, source, doc, resultCol, items });
        break;
      }
    }
    if (!sheets.length) throw new Error('前20行未找到“商品标题”和“测试结果”表头');
    return { file, bytes, zip, sheets };
  }
  function patchSheet(sheet) {
    // Patch only result cells in the original XML, leaving all other cells/formatting untouched.
    let source = sheet.source;
    for (const item of sheet.items.filter(i => i.result)) {
      const ref = `${sheet.resultCol}${item.row}`;
      const rowPattern = new RegExp(`<row\\b[^>]*\\br="${item.row}"[^>]*>[\\s\\S]*?<\\/row>`);
      const match = source.match(rowPattern);
      if (!match) throw new Error(`找不到第${item.row}行`);
      const oldRow = match[0];
      const cellPattern = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
      const existing = oldRow.match(cellPattern)?.[0];
      const style = existing?.match(/\bs="([^"]*)"/)?.[1];
      const escaped = item.result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const replacement = `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${escaped}</t></is></c>`;
      let updated;
      if (existing) updated = oldRow.replace(cellPattern, () => replacement);
      else {
        const after = [...oldRow.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].find(m => columnNo(m[1]) > columnNo(sheet.resultCol));
        const index = after ? after.index : oldRow.lastIndexOf('</row>');
        updated = oldRow.slice(0, index) + replacement + oldRow.slice(index);
      }
      source = source.replace(rowPattern, () => updated);
    }
    xml(source);
    return source;
  }
  // Exposed only for offline tests, never on the web page's global scope.
  if (typeof module !== 'undefined' && module.exports) { module.exports = { openWorkbook, patchSheet, cellText, columnNo, resultState, checkTitle, setLock }; return; }

  const host = document.createElement('div'); host.id = 'dd-check-panel';
  host.style.cssText = 'position:fixed;right:18px;top:110px;z-index:2147483647';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
  :host{font:14px/1.5 "Microsoft YaHei",sans-serif;color:#203047}*{box-sizing:border-box}
  .box{width:350px;background:#fff;border:1px solid #dbe3ed;border-radius:12px;box-shadow:0 8px 32px #18314c30;overflow:hidden}
  header{background:#1677ff;color:white;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;font-weight:bold}
  main{padding:14px}p{margin:0 0 10px;font-size:12px;color:#58687c}button,select,input{font:inherit;border:1px solid #cbd5e1;border-radius:6px;padding:6px;background:white;color:#203047}
  button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.primary{background:#1677ff;color:white;border-color:#1677ff}
  .row{display:flex;gap:7px;margin:9px 0;align-items:center;flex-wrap:wrap}select{max-width:100%}#sheet{width:100%}
  #status{background:#f2f6fb;padding:9px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:180px;overflow:auto}
  label{font-size:12px}progress{width:100%;margin:6px 0}#min{border:0;color:white;background:transparent;padding:0 6px}#custom{width:78px}
  </style><section class="box"><header><span>抖店检查V${VERSION}</span><button id="min">收起</button></header><main>
  <p>① 先在页面设置平台、店铺和筛选条件。<br>② 选择 D:\\work\\影刀\\缓存 中的 Excel。<br>结果仅表示当前筛选条件下的标题搜索结果。</p>
  <div class="row"><button id="pick" class="primary">选择表格</button><button id="fallback">普通选择</button></div>
  <select id="sheet" disabled><option>尚未选择 .xlsx 文件</option></select>
  <div class="row"><label>检测间隔</label><select id="interval"><option value="1">1 秒</option><option value="2">2 秒</option><option value="3" selected>3 秒</option><option value="5">5 秒</option><option value="10">10 秒</option><option value="custom">自定义</option></select><input id="custom" type="number" min="0.5" max="300" step="0.5" value="3" hidden><label id="unit" hidden>秒</label></div>
  <p>每条加载完成后再等待；间隔可在运行中调整。</p>
  <label><input type="checkbox" id="skip" checked> 跳过已有测试结果（失败项会重试）</label><br>
  <label><input type="checkbox" id="overwrite" checked> 完成后保存到原文件（需浏览器授权）</label>
  <div class="row"><button id="start" class="primary" disabled>开始 / 继续</button><button id="pause" disabled>暂停</button><button id="save" disabled>保存结果</button><button id="download" disabled>下载副本</button></div>
  <progress id="progress" max="1" value="0"></progress><div id="status">等待选择表格。首次选择请手动进入缓存目录。</div>
  <input id="file" type="file" accept=".xlsx" hidden>
  </main></section>`;
  document.body.append(host);
  const el = id => ui.getElementById(id);
  let workbook = null, fileHandle = null, running = false, stop = false, dirty = false, saving = false;
  const status = text => { el('status').textContent = text; };
  const selected = () => workbook?.sheets[Number(el('sheet').value)];
  function controls() {
    for (const id of ['pick', 'fallback', 'sheet', 'skip']) el(id).disabled = running || saving;
    el('start').disabled = !workbook || running || saving;
    el('pause').disabled = !running;
    for (const id of ['save', 'download']) el(id).disabled = !workbook || running || saving;
  }
  function interval() {
    const n = Number(el('interval').value === 'custom' ? el('custom').value : el('interval').value);
    if (!Number.isFinite(n) || n < 0.5 || n > 300) throw new Error('检测间隔请输入0.5到300秒');
    return n;
  }
  const pref = GM_getValue('interval', { mode: '3', custom: '3' });
  if (['1','2','3','5','10','custom'].includes(pref.mode)) el('interval').value = pref.mode;
  el('custom').value = pref.custom;
  function intervalChanged() {
    el('custom').hidden = el('unit').hidden = el('interval').value !== 'custom';
    try { interval(); GM_setValue('interval', { mode: el('interval').value, custom: el('custom').value }); } catch (e) { status(e.message); }
  }
  intervalChanged(); el('interval').onchange = el('custom').onchange = intervalChanged;
  el('min').onclick = () => { const main = ui.querySelector('main'); main.hidden = !main.hidden; el('min').textContent = main.hidden ? '展开' : '收起'; };
  async function load(file, handle) {
    status('正在读取 Excel…');
    const next = await openWorkbook(file);
    workbook = next; fileHandle = handle; dirty = false;
    el('sheet').replaceChildren(...next.sheets.map((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${s.name}（${s.items.length}条）`; return o; }));
    el('overwrite').checked = !!handle;
    el('progress').value = 0;
    status(`${file.name}\n已读取 ${next.sheets.length} 个可检测工作表。${handle ? '支持保存原文件。' : '普通选择模式：完成后下载结果副本。'}`);
    controls();
  }
  function mayReplace() { return !dirty || confirm('当前结果尚未保存，仍要选择另一个表格吗？'); }
  el('pick').onclick = async () => {
    if (!mayReplace()) return;
    if (!window.showOpenFilePicker) { el('file').click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker({ id: 'doudian-cache', multiple: false, types: [{ description: 'Excel 工作簿', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      await load(await handle.getFile(), permission === 'granted' ? handle : null);
    } catch (e) { if (e.name !== 'AbortError') status(`选择失败：${e.message}\n可以点击“普通选择”，完成后下载副本。`); }
  };
  el('fallback').onclick = () => { if (mayReplace()) el('file').click(); };
  el('file').onchange = async e => {
    try { if (e.target.files[0]) await load(e.target.files[0], null); } catch (err) { status(err.message); }
    e.target.value = '';
  };
  async function exportBlob() {
    for (const s of workbook.sheets) if (s.items.some(i => i.result)) workbook.zip.file(s.path, patchSheet(s));
    return workbook.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function save(copy = false) {
    if (!workbook || saving) return;
    saving = true; controls();
    try {
      const blob = await exportBlob();
      if (!copy && fileHandle && el('overwrite').checked) {
        const current = await fileHandle.getFile();
        if (current.size !== workbook.file.size || current.lastModified !== workbook.file.lastModified) throw new Error('原文件已被其他程序修改；请点击下载副本，避免覆盖');
        const writable = await fileHandle.createWritable();
        try { await writable.write(blob); await writable.close(); } catch (err) { await writable.abort().catch(() => {}); throw err; }
        workbook.file = await fileHandle.getFile(); dirty = false;
        status(`已保存到原文件：${workbook.file.name}`);
      } else {
        const a = document.createElement('a'), url = URL.createObjectURL(blob);
        const stamp = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '');
        a.href = url; a.download = workbook.file.name.replace(/\.xlsx$/i, `_抖店检查_${stamp}.xlsx`);
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        dirty = false; status('已发起结果副本下载，请在浏览器下载列表确认保存成功。');
      }
    } catch (err) { status(`保存失败：${err.message}\n检测结果仍在内存中，请勿刷新，可点击“下载副本”。`); }
    finally { saving = false; controls(); }
  }
  el('save').onclick = () => save(); el('download').onclick = () => save(true);
  el('pause').onclick = () => { stop = true; status('正在暂停：等待当前商品完成后停止，可继续或保存结果。'); };
  el('start').onclick = async () => {
    if (!workbook || running) return;
    let lockedHere = false, failed = false;
    try {
      interval();
      const sheet = selected();
      if (!sheet?.items.length) throw new Error('当前工作表没有商品标题');
      const tasks = sheet.items.filter(i => !el('skip').checked || !(i.result || i.old) || (i.result || i.old).startsWith('检测失败'));
      if (!tasks.length) { status('没有待检测商品。可取消“跳过已有测试结果”后重新检测。'); return; }
      running = true; stop = false; controls();
      const ctx = await rpc('context');
      if (!confirm(`检测范围：${ctx}\n工作表：${sheet.name}，待检测 ${tasks.length} 条。\n检测期间请勿切换标签或修改平台/店铺。开始吗？`)) return;
      await rpc('lock'); lockedHere = true;
      el('progress').max = tasks.length; el('progress').value = 0;
      for (let i = 0; i < tasks.length && !stop; i++) {
        const item = tasks[i];
        status(`${ctx}\n${i + 1}/${tasks.length}，Excel 第${item.row}行\n${item.title}\n检测中…`);
        try { item.result = (await rpc('check', item.title)).text; }
        catch (err) { item.result = `检测失败：${err.message}`; failed = true; stop = true; }
        dirty = true; el('progress').value = i + 1;
        status(`${i + 1}/${tasks.length}：${item.result}\n${item.title}`);
        if (!stop && i + 1 < tasks.length) {
          const since = Date.now();
          while (!stop && Date.now() - since < interval() * 1000) await sleep(100);
        }
      }
      if (!stop) await save();
      else status(failed ? '检测异常，已暂停。失败原因已写入测试结果；请检查页面后继续，或保存当前结果。' : '已暂停。可继续检测，或保存当前结果。');
    } catch (err) { status(err.message); }
    finally {
      if (lockedHere) { try { await rpc('unlock'); } catch (err) { status(`${el('status').textContent}\n页面解锁失败：${err.message}`); } }
      running = false; controls();
    }
  };
  window.addEventListener('beforeunload', e => { if (dirty || running) { e.preventDefault(); e.returnValue = ''; } });
})();
