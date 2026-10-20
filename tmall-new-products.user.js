// ==UserScript==
// @name         DouDian 天猫新品采集表
// @namespace    doudian.local
// @version      1.3.0
// @homepageURL  https://github.com/anysky911/DouDian
// @downloadURL  https://raw.githubusercontent.com/anysky911/DouDian/main/tmall-new-products.user.js
// @updateURL    https://raw.githubusercontent.com/anysky911/DouDian/main/tmall-new-products.user.js
// @description  采集店名、标题和链接，按新版表头预留货号及三列结果，自动适配行列尺寸并导出 Excel。
// @match        https://*.tmall.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// ==/UserScript==

(() => {
  'use strict';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const validId = value => /^\d{6,20}$/.test(String(value ?? ''));
  const TITLE_SELECTOR = '[class*="title--"], .detail a, .item-name, .title, a[title]';
  const CARD_SELECTOR = '[data-item-id], [data-itemid], [class*="cardContainer--"], .J_TItems .item, .shop-hesper-bd .item, .item5line1 .item, .item4line1 .item';
  function domLink(card) {
    // 商品ID属性优先，不能把 SKU 缩略图或广告链接当作当前商品。
    for (const attr of ['data-item-id', 'data-itemid']) {
      const id = card.getAttribute(attr);
      if (validId(id)) return { id, url: `https://detail.tmall.com/item.htm?id=${id}` };
    }
    for (const el of [card, ...card.querySelectorAll('a[href]')]) {
      const parsed = productUrl(el.getAttribute('href'));
      if (parsed) return parsed;
    }
    return null;
  }
  function collect(doc, isVisible = () => true, resolveLink = domLink) {
    const items = new Map(), cards = new Set();
    // 从完整标题向上寻找同一商品容器，兼容 class 后缀变化和嵌套 wrapper。
    for (const title of doc.querySelectorAll(TITLE_SELECTOR)) {
      const card = title.closest('[data-item-id], [data-itemid]') || title.closest(CARD_SELECTOR);
      if (card && isVisible(card)) cards.add(card);
    }
    let missing = 0;
    for (const card of cards) {
      const el = card.querySelector(TITLE_SELECTOR);
      const title = clean(el?.getAttribute('title') || el?.textContent).replace(/^天猫\s*/, '');
      const link = title && resolveLink(card, title);
      if (link) items.set(link.id, { title, ...link });
      else missing++;
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      if (!isVisible(a) || a.closest(CARD_SELECTOR)) continue;
      const link = productUrl(a.getAttribute('href'));
      if (!link || items.has(link.id)) continue;
      const el = a.querySelector('[class*="title--"]');
      const title = clean(el?.getAttribute('title') || el?.textContent || a.getAttribute('title') || a.textContent || a.querySelector('img')?.alt).replace(/^天猫\s*/, '');
      if (title.length < 6 || title.length > 200 || /^[¥￥\d.,\s]+$/.test(title)) continue;
      items.set(link.id, { title, ...link });
    }
    return { items: [...items.values()], missing, cards: cards.size };
  }
  function productUrl(raw) {
    try {
      const u = new URL(String(raw), 'https://detail.tmall.com');
      if (!['https:', 'http:'].includes(u.protocol)) return null;
      if (!['detail.tmall.com', 'item.taobao.com', 'detail.tmall.hk'].includes(u.hostname)) return null;
      if (u.pathname !== '/item.htm') return null;
      const id = u.searchParams.get('id');
      return validId(id) ? { id, url: `https://${u.hostname}/item.htm?id=${id}` } : null;
    } catch { return null; }
  }
  const sameTitle = (a, b) => clean(a).replace(/^天猫\s*/, '') === clean(b).replace(/^天猫\s*/, '');
  // 新版 React 卡片没有 href。仅遍历卡片关联的 props 中的数据对象，不读取 Cookie/令牌。
  function fromProps(root, expectedTitle) {
    const seen = new WeakSet();
    const queue = [{ value: root, depth: 0 }];
    let visited = 0;
    while (queue.length && visited++ < 600) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (value.nodeType || depth > 7) continue;
      const titles = ['title', 'itemTitle', 'itemName', 'name', 'auctionTitle'].map(k => value[k]).filter(v => typeof v === 'string');
      if (titles.some(t => sameTitle(t, expectedTitle))) {
        for (const key of ['itemUrl', 'detailUrl', 'auctionUrl', 'url', 'href']) {
          const parsed = typeof value[key] === 'string' && productUrl(value[key]);
          if (parsed) return parsed;
        }
        for (const key of ['itemId', 'item_id', 'auctionId', 'auction_id', 'id']) {
          const id = value[key];
          if (validId(id)) return { id: String(id), url: `https://detail.tmall.com/item.htm?id=${id}` };
        }
      }
      for (const key of Object.keys(value)) {
        if (['children', '_owner', 'ref', 'return', 'stateNode'].includes(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor && descriptor.value && typeof descriptor.value === 'object') {
          queue.push({ value: descriptor.value, depth: depth + 1 });
        }
      }
    }
    return null;
  }
  function csvCell(value) {
    let s = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const headers = ['店铺名称', '商品标题', '货号', '标题结果', '货号结果', '数字', '商品链接', '商品ID', '店铺地址', '采集时间', '来源页面', '列表口径'];
  const exportRow = r => [r.shop, r.title, r.sku || '', '', '', '', r.url, r.id, r.shopUrl, r.time, r.source, '用户确认的新品排序列表'].map(v => String(v ?? ''));
  function csv(rows) {
    return '\uFEFF' + [
      headers,
      ...rows.map(exportRow)
    ].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const textWidth = value => [...String(value ?? '')].reduce((n, c) => n + (c.codePointAt(0) > 255 ? 2 : 1), 0);
  function exportName(rows, date = new Date()) {
    const names = [...new Set(rows.map(r => clean(r.shop) || '未命名店铺'))];
    let shop = names.join('+');
    if (shop.length > 100) shop = names[0].slice(0, 70) + `等${names.length}店`;
    shop = shop.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '') || '未命名店铺';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replace(/-/g, '');
    return `${shop}_${day}_${rows.length}条.xlsx`;
  }
  // 无外部依赖的 ZIP（Store 模式），生成标准 OOXML .xlsx，不使用伪装的 HTML/XLS。
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    const crc = bytes => {
      let n = 0xffffffff;
      for (const b of bytes) { n ^= b; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
      return (n ^ 0xffffffff) >>> 0;
    };
    for (const [name, text] of Object.entries(files)) {
      const filename = encoder.encode(name), data = encoder.encode(text), checksum = crc(data);
      const header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
      view.setUint16(12, 33, true); view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, filename.length, true); header.set(filename, 30);
      chunks.push(header, data);
      const record = new Uint8Array(46 + filename.length), cv = new DataView(record.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true);
      cv.setUint32(16, checksum, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); record.set(filename, 46);
      central.push(record); offset += header.length + data.length;
    }
    const size = central.reduce((sum, x) => sum + x.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + end.length); let pos = 0;
    for (const chunk of [...chunks, ...central, end]) { result.set(chunk, pos); pos += chunk.length; }
    return result;
  }
  function xlsx(rows) {
    const matrix = [headers, ...rows.map(exportRow)];
    const caps = [32, 60, 28, 18, 18, 12, 64, 24, 42, 30, 70, 30];
    const widths = headers.map((h, i) => Math.min(caps[i], Math.max(i === 2 ? 18 : 12, ...matrix.slice(0, 1).map(row => textWidth(row[i]) + 3))));
    for (const row of matrix) row.forEach((value, i) => { widths[i] = Math.min(caps[i], Math.max(widths[i], ...value.split(/\r?\n/).map(line => textWidth(line) + 3))); });
    const lines = (text, width) => String(text).split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / Math.max(1, width - 3))), 0);
    const sheetRows = matrix.map((row, r) => {
      const height = r === 0 ? 28 : Math.min(409, Math.max(28, ...row.map((v, c) => lines(v, widths[c]) * 17 + 10)));
      return `<row r="${r + 1}" ht="${height}" customHeight="1">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" s="${r === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`;
    }).join('');
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    return zip({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${office}"><sheets><sheet name="新品采集" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${office}/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><dimension ref="A1:L${matrix.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="28"/><cols>${widths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" bestFit="1" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:L${matrix.length}"/></worksheet>`
    });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { productUrl, fromProps, csv, csvCell, collect, xlsx, exportName };
    return;
  }
  if (['detail', 'login', 'list', 'cart', 'www'].includes(location.hostname.split('.')[0])) return;
  if (document.getElementById('doudian-collector')) return;
  const prefix = 'doudian.product.v1.';
  const shopKey = `doudian.shop.${location.hostname}`;
  const shopUrl = `${location.origin}/`;
  const host = document.createElement('div');
  host.id = 'doudian-collector';
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{all:initial} *{box-sizing:border-box} .panel{position:fixed;right:18px;top:90px;width:330px;z-index:2147483646;background:white;color:#17212f;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 32px #0003;font:14px/1.55 system-ui,sans-serif;padding:14px}
      h3{margin:0 0 10px;font-size:16px} button,input{font:inherit} button{cursor:pointer;border:1px solid #ddd;background:#f5f6f8;color:#17212f;border-radius:6px;padding:6px 10px} button:hover{background:#e6eaf0} button:disabled{opacity:.5;cursor:default} .primary{background:#ef333f;color:#fff;border:0}.primary:hover{background:#cc2030}
      input[type=text]{width:100%;padding:7px;border:1px solid #ccc;border-radius:5px;margin:4px 0 8px} input[type=number]{width:65px} .row{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0} .muted{font-size:12px;color:#667085}.status{white-space:pre-wrap;margin:9px 0;max-height:130px;overflow:auto}.hide{display:none!important} .min{float:right;padding:0 7px} a{color:#155cc5} .shops{display:flex;gap:12px;font-size:12px}
      .overlay{position:fixed;inset:5vh 4vw;z-index:2147483647;background:#fff;border:1px solid #ccc;box-shadow:0 5px 40px #0005;border-radius:10px;padding:18px;display:flex;flex-direction:column;font:14px/1.5 system-ui,sans-serif;color:#17212f}.scroll{overflow:auto;flex:1}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}th{position:sticky;top:0;background:#f0f2f5}td:nth-child(2){min-width:240px}td:nth-child(3){min-width:120px}td:nth-child(7){word-break:break-all}td{white-space:normal;overflow-wrap:anywhere;vertical-align:middle} .head{display:flex;justify-content:space-between;margin-bottom:12px}
    </style>
    <section class="panel"><button class="min" id="min">收起</button><h3>DouDian · 新品表 v1.3.0</h3>
    <div id="body"><label>店铺名称<input type="text" id="shop" placeholder="请确认或输入店铺名称"></label>
    <label><input id="confirmed" type="checkbox"> 我已进入本店商品列表并选择“新品”</label>
    <div class="muted">仅采集当前列表；新品排序不等于近期上架。可手动翻页后继续采集。</div>
    <div class="row"><button id="scan" class="primary">采集当前列表</button><button id="run">滚动采集</button><button id="stop" disabled>停止</button></div>
    <label class="muted">滚动最多 <input id="rounds" type="number" min="1" max="100" value="30"> 次（每次约 1.5 秒）</label>
    <div id="status" class="status">等待采集。请先登录天猫并选择“新品”。</div><div id="count" class="muted"></div>
    <div class="row"><button id="preview">查看表格</button><button id="export">导出 Excel</button><button id="clear">清空全部</button></div>
    <div class="shops"><a href="https://amencl.tmall.com/" target="_blank" rel="noopener noreferrer">amencl</a><a href="https://xiaozhubite.tmall.com/" target="_blank" rel="noopener noreferrer">xiaozhubite</a><a href="https://mcticco.tmall.com/" target="_blank" rel="noopener noreferrer">mcticco</a></div>
    <p class="muted">数据保存在本机篡改猴中，三家店可累计导出。建议依次采集，导出后再清空。</p></div></section>
    <section class="overlay hide" id="overlay"><div class="head"><strong id="tableTitle">采集结果</strong><button id="close">关闭</button></div><div class="scroll"><table><thead><tr>${headers.map(h => `<th>${xml(h)}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div></section>`;
  const $ = id => shadow.getElementById(id);
  const status = text => { $('status').textContent = text; };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  function inferShop() {
    for (const selector of ['[class*="shopName--"]', '.slogo-shopname', '.shop-name', '.shopname']) {
      const el = [...document.querySelectorAll(selector)].find(visible);
      const text = clean(el?.textContent);
      if (text && text.length < 80) return text;
    }
    return clean(document.title.replace(/^(首页|所有宝贝|所有商品|本店搜索|店内搜索)[-－—]/, '').replace(/[-－—]天猫.*$/, ''));
  }
  $('shop').value = GM_getValue(shopKey, '') || inferShop();
  function allRows() {
    return GM_listValues().filter(k => k.startsWith(prefix)).map(k => GM_getValue(k)).filter(r => r?.id && r?.url).sort((a, b) => a.shop.localeCompare(b.shop, 'zh-CN') || a.time.localeCompare(b.time));
  }
  function refreshCount() {
    const rows = allRows();
    $('count').textContent = `本店 ${rows.filter(r => r.shopUrl === shopUrl).length} 条 / 全部 ${rows.length} 条`;
  }
  function cardLink(card, title) {
    const direct = domLink(card);
    if (direct) return direct;
    for (const el of [card, ...card.querySelectorAll('[class*="title--"]')]) {
      try {
        for (const key of Object.keys(el)) {
          if (key.startsWith('__reactProps$')) {
            const found = fromProps(el[key], title);
            if (found) return found;
          }
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
            let fiber = el[key];
            for (let depth = 0; fiber && depth < 6; depth++, fiber = fiber.return) {
              const found = fromProps(fiber.memoizedProps, title);
              if (found) return found;
            }
          }
        }
      } catch { /* 页面框架不支持时报告缺失，不伪造链接。 */ }
    }
    return null;
  }
  function extract() {
    return collect(document, visible, cardLink);
  }
  function check() {
    if (!$('confirmed').checked) throw new Error('请先手动选择店铺“新品”排序，再勾选确认框。');
    if (!clean($('shop').value)) throw new Error('请填写店铺名称。');
  }
  function scan() {
    check();
    const shop = clean($('shop').value);
    GM_setValue(shopKey, shop);
    const result = extract();
    let added = 0;
    for (const item of result.items) {
      const key = prefix + location.hostname + '.' + item.id;
      const previous = GM_getValue(key, null);
      if (!previous) added++;
      GM_setValue(key, { ...item, shop, shopUrl, source: location.href, time: previous?.time || new Date().toISOString() });
    }
    refreshCount();
    status(`本次识别 ${result.items.length} 条，新增 ${added} 条。` + (result.missing ? `\n${result.missing} 张卡片缺少标题或可验证链接，未完整采集。` : '') + (!result.items.length ? '\n请确认已登录、商品已加载且处于商品列表。若仍为 0，请提供当前页面地址以适配。' : ''));
    return { ...result, added };
  }
  function safe(action) { return () => { try { action(); } catch (e) { status(`操作未完成：${e.message}`); } }; }
  let running = false;
  let stopping = false;
  $('scan').onclick = safe(scan);
  $('stop').onclick = () => { stopping = true; status('正在停止…'); };
  $('run').onclick = async () => {
    if (running) return;
    try { check(); } catch (e) { status(e.message); return; }
    const limit = Math.max(1, Math.min(100, Number($('rounds').value) || 30));
    running = true; stopping = false;
    for (const id of ['scan', 'run', 'clear']) $(id).disabled = true;
    $('stop').disabled = false;
    let stale = 0, total = 0, reason = '已达到滚动次数上限；可继续采集或手动翻页。';
    try {
      for (let i = 0; i < limit && !stopping; i++) {
        const result = scan(); total += result.added;
        if (!result.items.length) { reason = '未识别到商品，请检查登录状态和当前列表。'; break; }
        const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100;
        stale = bottom && result.added === 0 ? stale + 1 : 0;
        if (stale >= 4) { reason = '已到页面底部且连续未新增；有下一页时请手动翻页继续。'; break; }
        status(`滚动采集 ${i + 1}/${limit}，累计新增 ${total} 条。\n当前缺少链接或标题的卡片：${result.missing}。`);
        window.scrollBy({ top: Math.max(400, window.innerHeight * .8), behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!stopping) total += scan().added;
      status(`本轮新增 ${total} 条。${stopping ? '已停止。' : reason}\n未识别的卡片不会导出；“采集当前列表”可查看缺失数。`);
    } catch (e) { status(`采集停止：${e.message}`); }
    finally {
      running = false;
      for (const id of ['scan', 'run', 'clear']) $(id).disabled = false;
      $('stop').disabled = true;
    }
  };
  $('preview').onclick = safe(() => {
    const rows = allRows(); $('rows').replaceChildren();
    $('tableTitle').textContent = `采集结果 · ${rows.length} 条（预览前 1000 条，导出含全部）`;
    rows.slice(0, 1000).forEach(r => {
      const tr = document.createElement('tr');
      exportRow(r).forEach((text, column) => {
        const td = document.createElement('td');
        if (column === 6) {
          const a = document.createElement('a');
          a.textContent = text; a.href = productUrl(text)?.url || '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
          td.append(a);
        } else td.textContent = text;
        tr.append(td);
      });
      $('rows').append(tr);
    });
    $('overlay').classList.remove('hide');
  });
  $('close').onclick = () => $('overlay').classList.add('hide');
  $('export').onclick = safe(() => {
    const rows = allRows();
    if (!rows.length) { status('暂无数据，请先采集。'); return; }
    const url = URL.createObjectURL(new Blob([xlsx(rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url;
    a.download = exportName(rows);
    shadow.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    status(`已生成 ${a.download}，请查看浏览器下载列表。\n标题结果、货号结果、数字列留空，列宽和行高已按内容适配。`);
  });
  $('clear').onclick = safe(() => {
    if (!confirm('清空所有店铺的采集数据？此操作不能撤销，请先导出。')) return;
    GM_listValues().filter(k => k.startsWith(prefix)).forEach(k => GM_deleteValue(k));
    $('rows').replaceChildren(); $('overlay').classList.add('hide'); refreshCount(); status('已清空所有店铺采集数据。');
  });
  $('min').onclick = () => { $('body').classList.toggle('hide'); $('min').textContent = $('body').classList.contains('hide') ? '展开' : '收起'; };
  window.addEventListener('focus', refreshCount);
  // 单页路由切换后重新确认，避免把其他分类误认为新品。
  let lastUrl = location.href;
  setInterval(() => {
    if (lastUrl !== location.href) {
      lastUrl = location.href; stopping = true; $('confirmed').checked = false;
      status('页面已切换，请重新确认新品排序后继续。');
    }
  }, 800);
  refreshCount();
})();
