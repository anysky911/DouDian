// ==UserScript==
// @name         生意市场数据自动导出
// @namespace    local.waxiang.market-rank
// @version      2.0.0
// @description  读取并确认网页当前日期及周期；逐类加载、人工确认下载；日期分组检查点，不自动启动。
// @match        https://sycm.taobao.com/mc/free/market_rank*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

/* 无依赖、无网络请求。DOM适配仅根据截图设计，未经目标现场验证。
 * 保守默认：人工设置类目，助手点击分析/加载全部，人工确认加载证据后才导出。
 * 原生下载无法由普通用户脚本通用检测，必须逐类人工确认下载成功。
 *
 * 生意市场数据自动导出 v2.0.0（由已交付v1.0.0升级）
 * 本次更新：取消固定日期；读取网页统计时间并与URL交叉核对；冻结本轮日期+周期；
 * 按日期+周期隔离检查点，使用共享UI锁阻止不同日期并发；保留旧版导出账本。
 * 旧日期仅出现在旧版迁移代码中，不是新版运行限制。没有联网库或自动更新源。
 *
 * 手动使用：先停用旧名“生意参谋17类目导出助手（人工确认版）”脚本并刷新页面，
 * 将本完整文件装入Tampermonkey。先用网站原生控件选择7天/30天/日/周/月和具体日期；
 * 点击“读取当前页面时间范围”，核对并确认后开始。助手不代点网页日期按钮。
 * 换日期时先停止当前轮、关闭旧分析窗，等网站统计时间更新后重新读取并确认。
 * 实时不作为稳定区间；日期读不到或URL/页面冲突会暂停，不用今天推算日期。
 * 每类人工核对加载变化、末页、累计行数后允许导出一次；下载成功仍须你人工确认。
 * 暂停保留锁；停止释放锁。恢复/刷新不复用旧加载证据，已记录导出意图不自动重导出。
 * 新版保存到独立localStorage键；旧版键原样保留，旧范围+recent7可安全迁移。
 * “新建一轮”会明确确认并归档当前键，可能重新导出；不要中途清除站点存储。
 * 本交付只含一个JS；没有安装、注入或运行到用户业务页面，不能承诺无需DOM适配。
 */
(function () {
  'use strict';
  const SCRIPT_VERSION = '2.0.0';
  const VERSION = 2;
  const PATH = '/mc/free/market_rank';
  const PRIMARY = '童装/婴儿装/亲子装';
  const CATEGORIES = [
    ['衬衫', ''], ['T恤', ''],
    ['儿童户外服', '儿童速干T恤'], ['儿童户外服', '儿童速干衬衫'],
    ['儿童户外服', '儿童冲锋衣'], ['儿童户外服', '儿童抓绒衣'],
    ['儿童户外服', '儿童皮肤衣/防晒衣'], ['儿童POLO衫', ''],
    ['儿童牛仔', '儿童牛仔外套'], ['儿童牛仔', '儿童牛仔裙'],
    ['儿童牛仔', '儿童牛仔衬衫'], ['儿童牛仔', '儿童牛仔裤'],
    ['外套/夹克/大衣', ''], ['卫衣', ''], ['毛衣', ''], ['裤子', ''], ['半身裙', '']
  ];
  // 仅用于读取旧版检查点；旧键和其中的导出记录永不删除或覆盖。
  const LEGACY_KEY = 'wx-market-rank-fixed-20261011-20261017-v1';
  const GLOBAL_LOCK = 'wx-market-rank-ui-exclusive-v2';
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/[＞>›]/g, '>');
  const categoryName = i => CATEGORIES[i] ? CATEGORIES[i].filter(Boolean).join(' > ') : '全部完成';

  function checkURL(value) {
    const u = new URL(value);
    if (u.origin !== 'https://sycm.taobao.com' || u.pathname !== PATH) return '页面不是指定的生意参谋市场排行地址';
    if (u.searchParams.get('activeKey') !== 'item') return '网址activeKey不是item（商品榜）';
    if (u.searchParams.get('parentCateId') !== '124412002') return '网址一级类目编号不符（应为124412002）';
    return '';
  }
  function normalizeDate(value) {
    const m = String(value).trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    if (!m) throw new Error('日期必须包含真实的年、月、日，不能用系统日期推算');
    const year = +m[1], month = +m[2], day = +m[3];
    const d = new Date(Date.UTC(year, month - 1, day));
    if (year < 2000 || year > 9999 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new Error('日期无效：' + value);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function parseRange(value) {
    const text = String(value || '').trim();
    const tokens = text.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g) || [];
    if (tokens.length < 1 || tokens.length > 2) throw new Error('未读到明确的开始/结束日期（单日可以只有一个完整日期）');
    if (tokens.length === 1 && text !== tokens[0]) throw new Error('单日日期后存在未完成的区间，请等待页面显示真实结束日期');
    const rest = text.replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, '').replace(/[\s|~～至到—–\-:,，：]/g, '');
    if (rest) throw new Error('日期区间包含无法识别的文字或不完整日期：' + text);
    const start = normalizeDate(tokens[0]), end = normalizeDate(tokens[1] || tokens[0]);
    if (start > end) throw new Error('开始日期晚于结束日期');
    return { start, end };
  }
  function periodKind(value) {
    const t = norm(value).toLowerCase();
    const groups = {
      recent7: ['7天', '近7天', '最近7天', 'recent7', 'last7'],
      recent30: ['30天', '近30天', '最近30天', 'recent30', 'last30'],
      day: ['日', '单日', 'day', 'daily', 'today', 'yesterday'],
      week: ['周', '自然周', 'week', 'weekly'],
      month: ['月', '自然月', 'month', 'monthly'],
      realtime: ['实时', 'realtime', 'real-time', 'real_time', 'hour']
    };
    return Object.keys(groups).find(k => groups[k].includes(t)) || '';
  }
  const periodLabel = kind => ({ recent7: '7天', recent30: '30天', day: '日', week: '周', month: '月', realtime: '实时' }[kind] || '自定义');
  const rangeIdentity = r => JSON.stringify([r.start, r.end, r.period.key]);
  const checkpointKey = r => 'wx-market-rank-v2:' + encodeURIComponent(rangeIdentity(r));
  function resolveRange({ href, pageTexts = [], selectedPeriods = [] }) {
    const problem = checkURL(href); if (problem) throw new Error(problem);
    const u = new URL(href), rawType = (u.searchParams.get('dateType') || '').trim();
    const rawRange = u.searchParams.get('dateRange');
    const urlRange = rawRange ? parseRange(rawRange) : null;
    const found = pageTexts.map(text => parseRange(text));
    const uniquePage = [...new Map(found.map(r => [r.start + '|' + r.end, r])).values()];
    if (uniquePage.length > 1) throw new Error('页面统计时间有多个不同区间，请等待页面刷新完成或关闭旧弹窗');
    const pageRange = uniquePage[0] || null;
    // URL单独存在并不能证明图表已刷新，必须读到页面统计时间用于交叉确认。
    if (!pageRange) throw new Error('未读到可见“统计时间/统计日期”的完整区间；请展开日期区域并等页面刷新，不能只凭网址开始');
    if (urlRange && (urlRange.start !== pageRange.start || urlRange.end !== pageRange.end)) throw new Error('网址dateRange与页面统计时间冲突，请等待或人工修正后重新读取');
    const uiKinds = [...new Set(selectedPeriods.map(periodKind).filter(Boolean))];
    if (uiKinds.length > 1) throw new Error('页面出现多个选中时间周期，无法确定本轮周期');
    const uiKind = uiKinds[0] || '', urlKind = periodKind(rawType);
    if (uiKind && urlKind && uiKind !== urlKind) throw new Error('网址dateType与页面选中周期冲突，请等待页面刷新后重新读取');
    const kind = uiKind || urlKind || (rawType ? 'custom' : '');
    if (!kind) throw new Error('无法识别所选周期；请确保网页的日/周/月或其他日期模式处于明确选中状态');
    if (kind === 'realtime') throw new Error('实时统计会变化，无法冻结为已验证的稳定区间；请在网页选择带明确日期区间的7天/30天/日/周/月选项');
    const period = { kind, dateType: rawType, key: kind + ':' + (rawType || 'no-url-type'), label: periodLabel(kind) + (rawType ? `（${rawType}）` : '') };
    return { ...pageRange, period, source: urlRange ? '网址与页面统计时间一致' : '页面统计时间（网址无dateRange）' };
  }
  function assertFrozen(frozen, current) {
    if (!frozen || rangeIdentity(frozen) !== rangeIdentity(current)) throw new Error('日期或周期已改变：本轮已暂停。请先停止、关闭旧分析窗，再读取并确认新范围；旧进度不会移到新日期');
  }
  function invalidateRange(s) {
    s.invalidated = true; s.mustCloseDialogs = true; s.evidence = null; s.receipt = null;
    if (!s.ledger[s.index] && s.stage !== 'done') s.stage = 'category';
  }
  function legacyMatches(r) {
    // 这里的旧日期只是兼容旧版，不参与新版日期选择或运行校验。
    return r.start === '2026-10-11' && r.end === '2026-10-17' && r.period.kind === 'recent7' && r.period.dateType === 'recent7';
  }
  function migrateLegacy(old, range) {
    if (!legacyMatches(range)) return initial(range);
    if (!old || old.version !== 1 || !Number.isInteger(old.index) || old.index < 0 || old.index > 17 || !old.ledger || typeof old.ledger !== 'object') throw new Error('旧版检查点异常，不能自动从第一类重新导出；请保留旧键并人工核对');
    const s = initial(range); s.index = old.index; s.ledger = JSON.parse(JSON.stringify(old.ledger));
    s.legacyMigratedFrom = LEGACY_KEY; s.mustCloseDialogs = true;
    const current = s.ledger[s.index];
    s.stage = s.index === 17 ? 'done' : current ? (current.state === 'downloadConfirmed' ? 'close' : 'download') : 'category';
    return s;
  }
  function prepareRestored(s) {
    // 停止后恢复或刷新后，不复用上次加载证据/旧分析窗；导出账本单独保留。
    const entry = s.ledger[s.index];
    s.evidence = null; s.receipt = null;
    if (s.stage !== 'done') {
      if (entry) s.stage = entry.state === 'downloadConfirmed' ? 'close' : 'download';
      else if (!['category', 'filters'].includes(s.stage)) { s.stage = 'category'; s.mustCloseDialogs = true; }
    }
    return s;
  }
  function unique(nodes, label, visible = () => true) {
    const found = [...new Set(nodes)].filter(visible);
    if (found.length !== 1) throw new Error(found.length ? `“${label}”有${found.length}个可见候选，已暂停，未点击` : `找不到可见的“${label}”，请手动操作后继续`);
    return found[0];
  }
  function textCandidates(root, label, selector, visible) {
    return [...root.querySelectorAll(selector)].filter(e => visible(e) && norm(e.innerText || e.textContent) === norm(label));
  }
  function initial(range = null) {
    return { version: VERSION, range, index: 0, stage: 'category', status: 'idle', reason: '先在网页选择日期，再读取并确认本次范围', ledger: {}, evidence: null, receipt: null, log: [] };
  }
  function validateState(s) {
    const stages = ['category', 'filters', 'open', 'openWait', 'load', 'observe', 'review', 'export', 'download', 'close', 'closeWait', 'done'];
    if (!s || s.version !== VERSION || !Number.isInteger(s.index) || s.index < 0 || s.index > 17 || !stages.includes(s.stage) || !s.ledger || typeof s.ledger !== 'object') throw new Error('检查点格式异常；请保留检查点供排查，不自动重置');
    if (!s.range?.period?.key || !s.range.start || !s.range.end) throw new Error('新版检查点缺少日期/周期，禁止混用旧进度');
    // 只要本类已有导出意图，刷新/继续都不能自动再点击导出。
    if (s.index < 17 && s.ledger[s.index] && s.ledger[s.index].state !== 'downloadConfirmed') s.stage = 'download';
    return s;
  }
  function reserveExport(s, now) {
    if (s.ledger[s.index]) throw new Error('本类目已记录导出意图，禁止重复导出');
    s.ledger[s.index] = { category: categoryName(s.index), range: s.range ? JSON.parse(JSON.stringify(s.range)) : null, state: 'intent', at: now };
    s.stage = 'download';
  }
  function assertControl(status, token, currentEpoch, held) {
    if (token !== currentEpoch || status !== 'running' || !held) throw new Error('助手已暂停或停止；未执行后续点击');
  }
  function dispatchExport(s, button, persist, ready, now) {
    ready();
    reserveExport(s, now); persist();
    // persist失败时绝不点击；click抛错时保留intent，后续不得自动重试。
    button.click(); s.ledger[s.index].state = 'triggered'; persist();
  }
  function confirmDownload(s, now) {
    const entry = s.ledger[s.index];
    if (!entry || !['intent', 'triggered'].includes(entry.state)) throw new Error('本类目没有待确认导出记录');
    entry.state = 'downloadConfirmed'; entry.confirmedAt = now; s.stage = 'close';
  }
  function nextCategory(s) {
    if (s.ledger[s.index]?.state !== 'downloadConfirmed') throw new Error('必须人工确认下载成功后才能进入下一类');
    s.index++; s.stage = s.index === CATEGORIES.length ? 'done' : 'category';
    s.evidence = null; s.receipt = null;
  }
  function parseSnapshot(text) {
    const t = norm(text);
    const count = t.match(/共([\d,]+)行(?:数据)?/);
    const pages = t.match(/共(\d+)页/);
    const current = t.match(/第(\d+)页/);
    return {
      count: count ? Number(count[1].replace(/,/g, '')) : null,
      totalPages: pages ? Number(pages[1]) : null,
      page: current ? Number(current[1]) : null,
      busy: /正在加载|加载中|正在读取|读取中|加载进度/.test(t),
      terminal: /已加载全部|全部加载完成|加载完毕|已到最后一页|没有更多数据/.test(t)
    };
  }
  function newEvidence(snapshot, now) {
    return { before: snapshot, last: snapshot, started: now, changed: false, sawBusy: false, sawBusyEnd: false, maxPage: snapshot.page || 0, maxCount: snapshot.count || 0, samples: 0, quietSince: now };
  }
  function observe(e, s, now) {
    const changed = ['count', 'page', 'totalPages', 'busy', 'terminal'].some(k => s[k] !== e.last[k]);
    if (changed) { e.changed = true; e.quietSince = now; }
    if (s.busy) e.sawBusy = true;
    if (e.last.busy && !s.busy) e.sawBusyEnd = true;
    e.maxPage = Math.max(e.maxPage, s.page || 0);
    e.maxCount = Math.max(e.maxCount, s.count || 0);
    e.last = s; e.samples++;
    return e;
  }
  function assessment(e, now) {
    const s = e.last;
    const pages = s.totalPages;
    // 即使全部满足也只是候选证据；DOM未经验证，一律进入人工核对，不自动宣称完整。
    const candidate = e.changed && e.sawBusy && e.sawBusyEnd && !s.busy && s.terminal && pages !== null && pages >= 1 && pages <= 30 && s.page === pages && s.count !== null && now - e.quietSince >= 20000;
    return { candidate, reason: candidate ? '出现加载变化、加载结束、明确末页和累计记录；仍需人工核对' : '自动证据不足；需人工核对加载结束、实际末页、累计记录以及本次加载变化' };
  }
  const core = { SCRIPT_VERSION, norm, CATEGORIES, checkURL, normalizeDate, parseRange, periodKind, resolveRange, rangeIdentity, checkpointKey, assertFrozen, invalidateRange, legacyMatches, migrateLegacy, prepareRestored, unique, textCandidates, initial, validateState, reserveExport, assertControl, dispatchExport, confirmDownload, nextCategory, parseSnapshot, newEvidence, observe, assessment };
  // 仅供离线Node测试；浏览器分支不引入任何测试工具。
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (location.origin !== 'https://sycm.taobao.com' || location.pathname !== PATH || window.top !== window.self) return;
  if (document.getElementById('wx-rank-helper')) return;

  const ACTION_SELECTOR = 'button,[role="button"],a,input[type="button"],input[type="submit"],.ant-btn,.el-button';
  let state = initial(), KEY = '', selectedRange = null, candidateRange = null;
  let corrupt = '', active = false, epoch = 0, lockHeld = false, releaseLock = null;

  const host = document.createElement('div');
  host.id = 'wx-rank-helper';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;z-index:2147483647;left:50%;bottom:12px;transform:translateX(-50%);font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#17212b;max-width:96vw}
    *{box-sizing:border-box} .box{width:600px;max-width:96vw;background:#fff;border:2px solid #25725b;border-radius:12px;box-shadow:0 4px 25px #0004}
    header{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#e9f4ef;cursor:move;border-radius:10px}
    h3{font-size:14px;margin:0} main{padding:8px 12px;max-height:45vh;overflow:auto} p{margin:5px 0} button{font:inherit;padding:4px 9px;margin:3px 3px 3px 0;cursor:pointer;background:#f4f6f7;border:1px solid #93aaa1;border-radius:5px;color:#17212b} button:disabled{opacity:.45;cursor:default}
    .accent{background:#166848;color:white} .warn{color:#8b3700;background:#fff4dc;padding:5px} #detail{white-space:pre-wrap;font-size:12px} label{display:block;margin:4px 0} input[type=number]{width:85px} .hidden{display:none} summary{cursor:pointer} #gate{border-top:1px solid #ccc;margin-top:6px;padding-top:5px}
    </style><section class="box"><header><h3>生意市场数据自动导出 v${SCRIPT_VERSION}</h3><button id="collapse">收起</button></header><main>
      <p>先用网页原生7天/30天/日/周/月控件选择真实日期；助手不代点网页日期按钮。</p>
      <button id="readRange">读取当前页面时间范围</button><label><input id="rangeOK" type="checkbox">我已核对下方区间及周期与网页一致</label><button id="useRange">确认本次日期与周期</button>
      <p id="rangeDisplay"></p><p>一级类目：童装/婴儿装/亲子装</p>
      <p id="current"></p><p id="status"></p><p id="reason" class="warn"></p>
      <div><button id="start" class="accent">开始 / 继续检查点</button><button id="pause">暂停</button><button id="resume">继续</button><button id="stop">停止</button></div>
      <p>可拖动标题栏或收起面板；所有下载均需逐类人工确认。</p>
      <div id="gate"></div>
      <details><summary>加载证据与导出记录</summary><div id="detail"></div></details>
      <details><summary>适配与恢复</summary>
        <label><input id="autoCategory" type="checkbox">尝试自动切换类目（未经现场验证；失败后手动选择）</label>
        <button id="manualCategory">我已手动选择本类目</button><button id="manualOpen">我已手动打开本类分析窗</button>
        <button id="manualLoad">我已手动点击加载全部</button><button id="manualClose">我已关闭本类分析窗</button>
        <button id="recheck">重新核对本类筛选</button><button id="manualExport">登记手动导出（先登记，后自行点击）</button>
        <p>仅在对应阶段可用；导出意图存在时不会回退到导出。结果不明请检查下载记录，必要时手动导出一次后确认。</p>
        <button id="reset">新建一轮（将清除本机本日期检查点）</button>
      </details>
    </main></section>`;
  document.documentElement.appendChild(host);
  const $ = id => shadow.getElementById(id);

  function visible(e) {
    if (!e || !e.isConnected || e === host || host.contains(e)) return false;
    if (e.closest('[hidden],[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && [...e.getClientRects()].some(r => r.width > 0 && r.height > 0);
  }
  function enabled(e) { return !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[inert]') && !/(?:^|\s)(?:disabled|is-disabled|ant-btn-disabled)(?:\s|$)/.test(e.className || ''); }
  function action(root, label) {
    return unique(textCandidates(root, label, ACTION_SELECTOR, visible), label, visible);
  }
  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"],.ant-modal,.el-dialog,.layui-layer,.ivu-modal')].filter(visible).filter(e => !e.parentElement?.closest('[role="dialog"],.ant-modal,.el-dialog,.layui-layer,.ivu-modal'));
  }
  function analysisDialog() {
    const all = dialogs().filter(e => norm(e.innerText).includes('市场排行_商品_交易总量_不限_全网'));
    return unique(all, '分析弹窗（标题：市场排行_商品_交易总量_不限_全网）', visible);
  }
  function mainScope() {
    const roots = [...document.querySelectorAll('main,[role="main"]')].filter(visible);
    if (roots.length > 1) throw new Error('主页面区域有多个可见候选，已暂停');
    return roots[0] || document.body;
  }
  function readPageRange() {
    const root = mainScope();
    const outsideDialog = e => visible(e) && !e.closest('[role="dialog"],.ant-modal,.el-dialog,.layui-layer,.ivu-modal');
    const pageTexts = [];
    for (const e of root.querySelectorAll('span,div,p,label,section,li,td')) {
      if (!outsideDialog(e)) continue;
      const t = (e.innerText || '').trim();
      if (t.length > 240) continue;
      const match = t.match(/(?:统计时间|统计日期|数据时间)\s*[:：]?\s*((?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)(?:\s*(?:[|~～—–\-]|至|到)\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)?)/);
      if (match && /^(?:[|~～—–\-]|至|到)/.test(t.slice(match.index + match[0].length).trim())) throw new Error('页面统计时间的结束日期不完整，请等页面更新完成后重新读取');
      if (match) pageTexts.push(match[1]);
    }
    const periodSelectors = '[aria-selected="true"],[aria-pressed="true"],[aria-checked="true"],input:checked,.ant-radio-button-wrapper-checked,.ant-radio-wrapper-checked,.ant-tabs-tab-active,.ant-btn-primary,.selected,.active';
    const selectedPeriods = [...root.querySelectorAll(periodSelectors)].filter(outsideDialog).map(e => e.value || e.innerText || e.textContent || '');
    return resolveRange({ href: location.href, pageTexts, selectedPeriods });
  }
  function loadRangeState(range) {
    const raw = localStorage.getItem(checkpointKey(range));
    if (raw) { const s = validateState(JSON.parse(raw)); assertFrozen(range, s.range); return prepareRestored(s); }
    const legacy = legacyMatches(range) ? localStorage.getItem(LEGACY_KEY) : null;
    return legacy ? migrateLegacy(JSON.parse(legacy), range) : initial(range);
  }
  function snapshot() {
    const d = analysisDialog();
    const s = parseSnapshot(d.innerText);
    s.busy = s.busy || [...d.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask,.loading')].some(visible);
    // 只读取显式当前页语义，不把最大的分页按钮当成已读取的页数。
    const current = [...d.querySelectorAll('[aria-current="page"],.ant-pagination-item-active,.el-pager .active,.ivu-page-item-active')].filter(visible);
    if (current.length === 1 && /^\d+$/.test(norm(current[0].innerText))) s.page = Number(norm(current[0].innerText));
    return s;
  }
  function save() {
    // 写入失败会阻止后续点击，不能失去防重复导出的检查点。
    if (!lockHeld) throw new Error('未持有本轮标签页锁，禁止写入检查点');
    if (!KEY || !selectedRange) throw new Error('尚未确认本轮日期/周期，禁止写入检查点');
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  function note(message) {
    state.reason = message;
    state.log.push({ at: new Date().toISOString(), message });
    state.log = state.log.slice(-80);
  }
  function pause(message = '已暂停；页面自身已经开始的加载/下载可能仍会继续') {
    epoch++; state.status = 'paused'; note(message);
    if (lockHeld) { try { save(); } catch (e) { state.reason += '；检查点保存失败：' + e.message; } }
    render();
  }
  function guard(token) {
    assertControl(state.status, token, epoch, lockHeld);
    const problem = checkURL(location.href);
    if (problem) throw new Error(problem + '。请人工恢复页面和筛选');
    try { assertFrozen(state.range, readPageRange()); }
    catch (error) { invalidateRange(state); throw error; }
    if (state.mustCloseDialogs) {
      if (dialogs().length) throw new Error('日期切换/旧版迁移后必须先手动关闭旧分析窗，禁止复用旧弹窗和加载证据');
      state.mustCloseDialogs = false;
    }
    const text = document.body.innerText;
    if (/请完成验证|拖动滑块|安全验证|访问受限|登录已失效|请重新登录/.test(text)) throw new Error('页面出现验证、访问限制或登录提示；请自行处理后继续');
    // 核验确认后保存的筛选/类目摘要。任何可观察变化都会撤销本次操作。
    if (state.receipt && !['category', 'filters', 'close', 'closeWait', 'done', 'download'].includes(state.stage)) {
      const now = filterSignature();
      if (now !== state.receipt.signature) throw new Error('日期、类目或筛选的可见摘要发生变化，请重新人工核对后继续');
    }
  }
  function filterSignature() {
    const selectors = '[aria-selected="true"],[aria-checked="true"],input:checked,.ant-select-selection-item,.ant-select-selection-selected-value,.ant-cascader-picker-label,.el-input__inner,.ant-radio-button-wrapper-checked,.ant-tabs-tab-active';
    const vals = [...mainScope().querySelectorAll(selectors)].filter(e => visible(e) && !e.closest('[role="dialog"],.ant-modal,.el-dialog,.layui-layer,.ivu-modal'));
    return JSON.stringify(vals.map(e => norm(e.value || e.innerText || e.textContent)).filter(Boolean));
  }
  function clickOnce(e, nextStage, token) {
    guard(token);
    if (!visible(e) || !enabled(e)) throw new Error('目标控件不可见或已禁用，未点击');
    state.stage = nextStage; save();
    // checkpoint与click之间不await。点击结果不明时由已保存的下一阶段接管，不自动重试。
    e.click();
  }
  async function acquire(allowCorrupt = false) {
    if (lockHeld) return;
    if (!selectedRange || !KEY) throw new Error('请先读取当前页面时间范围，并确认本次日期与周期');
    if (!navigator.locks?.request) throw new Error('浏览器缺少Web Locks，无法保证多标签页不重复导出；请反馈浏览器版本');
    assertFrozen(selectedRange, readPageRange());
    const rangeKey = KEY;
    // 所有日期先共享UI锁，再占用该日期/周期锁；兼容旧版锁，避免旧新版并行点同一网页。
    const locks = [GLOBAL_LOCK, rangeKey + '-exclusive', LEGACY_KEY + '-exclusive'];
    await new Promise((resolve, reject) => {
      const take = async depth => {
        if (depth < locks.length) {
          return navigator.locks.request(locks[depth], { ifAvailable: true }, async lock => {
            if (!lock) throw new Error('另一个标签页或旧版助手正在操作该页面，请先在那里停止（不同日期也不能并发）');
            return take(depth + 1);
          });
        }
        try {
          try { state = loadRangeState(selectedRange); }
          catch (error) { if (!allowCorrupt) throw error; }
          if (KEY !== rangeKey) throw new Error('日期选择在取得锁时发生变化，请重新读取确认');
          assertFrozen(selectedRange, readPageRange());
          lockHeld = true;
          await new Promise(done => { releaseLock = done; resolve(); });
        } finally { lockHeld = false; releaseLock = null; }
      };
      take(0).catch(reject);
    });
  }
  async function wait(ms, token) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, Math.min(500, until - Date.now())));
      guard(token);
    }
  }
  async function tryCategory(token) {
    const trigger = unique([...mainScope().querySelectorAll('[role="combobox"],.ant-cascader-picker,.el-cascader')].filter(visible), '类目级联选择框', visible);
    guard(token); if (!enabled(trigger)) throw new Error('类目选择框已禁用'); trigger.click();
    await wait(500, token);
    const path = [PRIMARY, ...CATEGORIES[state.index].filter(Boolean)];
    for (let level = 0; level < path.length; level++) {
      const menus = [...document.querySelectorAll('.ant-cascader-menus,.el-cascader-panel,[role="tree"]')].filter(visible);
      const popup = unique(menus, '可见类目级联弹层', visible);
      const columns = [...popup.querySelectorAll('.ant-cascader-menu,.el-cascader-menu,[role="group"]')].filter(visible);
      if (!columns[level]) throw new Error(`找不到第${level + 1}列类目，请手动选择${categoryName(state.index)}`);
      const candidate = unique(textCandidates(columns[level], path[level], '[role="menuitem"],[role="treeitem"],li', visible), `第${level + 1}级：${path[level]}`, visible);
      guard(token); if (!enabled(candidate)) throw new Error('类目选项已禁用'); candidate.click();
      await wait(700, token);
    }
    state.stage = 'filters'; note('已尝试切换；请人工确认实际选中类目与全部筛选'); save(); render();
  }
  async function run() {
    if (active) return;
    active = true;
    const token = epoch;
    try {
      while (state.status === 'running') {
        guard(token); render();
        if (state.stage === 'category') {
          if ($('autoCategory').checked) { await tryCategory(token); continue; }
          note('请手动选择本类目，再点击“我已手动选择本类目”'); save(); render(); return;
        }
        if (state.stage === 'filters') { note('请逐项核对本类目、本轮日期/周期和筛选，再允许分析'); save(); render(); return; }
        if (state.stage === 'open') {
          if (dialogs().length) throw new Error('打开分析前仍有可见弹窗，请人工处理');
          clickOnce(action(mainScope(), '一键分析'), 'openWait', token);
          await wait(1500, token); continue;
        }
        if (state.stage === 'openWait') {
          analysisDialog(); state.stage = 'load'; save(); continue;
        }
        if (state.stage === 'load') {
          const d = analysisDialog();
          if (!/间隔\s*15\s*秒|15\s*秒/.test(d.innerText)) throw new Error('无法确认弹窗加载间隔为15秒，请手动核对；助手不会更改间隔');
          const before = snapshot();
          if (before.busy) throw new Error('弹窗已在加载，请勿再次点击加载全部；可手动接管观察');
          state.evidence = newEvidence(before, Date.now());
          clickOnce(action(d, '加载全部'), 'observe', token); continue;
        }
        if (state.stage === 'observe') {
          if (!state.evidence) throw new Error('缺少加载前的观察基线，请手动接管并核对本次加载变化');
          observe(state.evidence, snapshot(), Date.now()); save();
          const a = assessment(state.evidence, Date.now());
          if (a.candidate || Date.now() - state.evidence.started > 12 * 60 * 1000) {
            state.stage = 'review'; note(a.reason); save(); render(); return;
          }
          note('正在观察加载，保留原有15秒间隔；可在证据区转入人工核对（不会直接导出）'); render();
          await wait(1500, token); continue;
        }
        if (state.stage === 'review') { render(); return; }
        if (state.stage === 'export') {
          const d = analysisDialog();
          if (snapshot().busy) throw new Error('导出前仍检测到加载中，已暂停');
          const button = action(d, '导出表格');
          guard(token);
          if (!visible(button) || !enabled(button)) throw new Error('导出按钮不可用，未触发');
          dispatchExport(state, button, save, () => guard(token), new Date().toISOString());
          note('已触发导出表格点击；请检查下载记录和文件。此状态不表示文件已落盘'); save(); render(); return;
        }
        if (state.stage === 'download') { render(); return; }
        if (state.stage === 'close') {
          const all = dialogs();
          if (!all.length) { nextCategory(state); save(); continue; }
          const d = analysisDialog();
          const closers = [...d.querySelectorAll('button[aria-label],button[title],[role="button"][aria-label],.ant-modal-close,.el-dialog__headerbtn,.layui-layer-close')].filter(e => visible(e) && (/关闭|close/i.test((e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '')) || e.matches('.ant-modal-close,.el-dialog__headerbtn,.layui-layer-close')));
          clickOnce(unique(closers, '当前分析弹窗关闭按钮', visible), 'closeWait', token);
          await wait(500, token); continue;
        }
        if (state.stage === 'closeWait') {
          if (dialogs().length) throw new Error('仍有可见弹窗，请手动关闭后继续');
          nextCategory(state); save(); continue;
        }
        if (state.stage === 'done') {
          state.status = 'done'; note('17项均已由你人工确认下载成功。请保留导出文件并自行检查内容'); save(); render(); releaseLock?.(); return;
        }
      }
    } catch (error) { pause(error.message); }
    finally { active = false; render(); }
  }
  async function start() {
    try {
      if (corrupt) throw new Error(corrupt);
      if (active) throw new Error('前一轮异步观察正在退出，请稍后再继续');
      await acquire();
      state.status = 'running'; epoch++; save(); render(); await run();
    } catch (error) { pause(error.message); }
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const labels = { category: '选择类目', filters: '人工核对筛选', open: '打开分析', openWait: '核对分析窗', load: '加载全部', observe: '观察加载变化', review: '人工核对末页和记录数', export: '准备导出', download: '待人工确认下载', close: '关闭分析窗', closeWait: '核对关闭', done: '完成' };
  function render() {
    const showRange = candidateRange || selectedRange;
    $('rangeDisplay').textContent = showRange ? `${candidateRange ? '待读取确认' : '本次已确认'}：${showRange.start} 至 ${showRange.end} · ${showRange.period.label} · ${showRange.source}` : '尚未读取页面日期；不会沿用旧版固定日期。';
    $('current').textContent = `${Math.min(state.index + 1, 17)} / 17：${categoryName(state.index)}`;
    $('status').textContent = `${state.status} · ${labels[state.stage]}`;
    $('reason').textContent = state.reason;
    const running = state.status === 'running';
    $('readRange').disabled = active || lockHeld || running;
    $('useRange').disabled = active || lockHeld || running || !candidateRange;
    $('rangeOK').disabled = active || lockHeld || running || !candidateRange;
    $('start').disabled = active || running || !!corrupt || !selectedRange || state.stage === 'done';
    $('resume').disabled = active || running || !!corrupt || !selectedRange || state.stage === 'done';
    $('pause').disabled = !running;
    $('manualCategory').disabled = !selectedRange || active || !['category', 'filters'].includes(state.stage);
    $('manualOpen').disabled = !selectedRange || active || !['open', 'openWait'].includes(state.stage);
    $('manualLoad').disabled = !selectedRange || active || !['load', 'observe'].includes(state.stage);
    $('manualClose').disabled = !selectedRange || active || !['close', 'closeWait'].includes(state.stage);
    $('recheck').disabled = !selectedRange || active || !!state.ledger[state.index] || state.stage === 'done';
    $('manualExport').disabled = active || state.stage !== 'export' || !!state.ledger[state.index];
    const e = state.evidence;
    $('detail').textContent = (e ? `本次加载后变化：${e.changed}\n见过加载中：${e.sawBusy}\n见过加载结束：${e.sawBusyEnd}\n可读当前页最大值：${e.maxPage || '未知'}\n当前页：${e.last.page ?? '未知'} / 明确总页数：${e.last.totalPages ?? '未知'}\n累计记录：${e.last.count ?? '未知'}\n明确末页/完成文本：${e.last.terminal}\n${assessment(e, Date.now()).reason}\n注意：页数和行数稳定不能证明完整。\n\n` : '') + JSON.stringify(state.ledger, null, 2);
    // 不在相同阶段反复重建人工表单，避免轮询清空用户输入。
    const gateKey = `${KEY}:${state.index}:${state.stage}:${running}`;
    if ($('gate').dataset.key === gateKey) return;
    $('gate').dataset.key = gateKey;
    $('gate').innerHTML = '';
    if (!running) return;
    if (state.stage === 'filters') {
      $('gate').innerHTML = `<p>请逐项核对后勾选，无法核对请暂停。</p>` + [
        `一级：${PRIMARY}；二/三级：${categoryName(state.index)}（二级项目须未选三级）`,
        `日期控件显示${state.range.start}至${state.range.end}；周期${state.range.period.label}；商品榜；交易总量`,
        '价格不限；店铺全部/全网；导出选项和下载目录沿用已设置值'
      ].map((t, i) => `<label><input type="checkbox" id="f${i}">${escapeHTML(t)}</label>`).join('') + '<button id="approveFilters" class="accent">筛选已核对，打开分析</button>';
      $('approveFilters').onclick = () => safeUI(async () => {
        if (![0, 1, 2].every(i => $('f' + i).checked)) throw new Error('请完成全部人工核对');
        guard(epoch); state.receipt = { signature: filterSignature(), confirmedAt: new Date().toISOString() };
        state.stage = 'open'; save(); await run();
      });
    } else if (state.stage === 'observe') {
      $('gate').innerHTML = '<button id="reviewNow">停止自动观察，转入人工完整性核对</button>';
      $('reviewNow').onclick = () => {
        epoch++; state.stage = 'review'; note('已转入人工核对；页面的加载可能仍在继续，结束前不可导出'); save(); render();
      };
    } else if (state.stage === 'review') {
      $('gate').innerHTML = `<p>自动适配未验证。请观察本次加载确实发生变化，加载结束后核对实际末页与累计行数；30页示例为300行，不能套用到所有类目。</p>
        <label><input type="checkbox" id="r0">我看到了本次加载后的页码/累计记录/加载状态变化</label>
        <label><input type="checkbox" id="r1">加载已结束；已核对实际最后一页（最多30页；不足30页按实际末页）</label>
        <label><input type="checkbox" id="r2">累计记录数与实际已加载记录相符；确认不是仅选中了第30页</label>
        <label>核对实际末页：<input id="pages" type="number" min="1" max="30" step="1"> 累计记录：<input id="rows" type="number" min="1" step="1"></label>
        <button id="approveExport" class="accent">以上已核对，允许本类导出一次</button>`;
      $('approveExport').onclick = () => safeUI(async () => {
        if (active) throw new Error('观察循环正在退出，请稍后再次确认');
        if (![0, 1, 2].every(i => $('r' + i).checked)) throw new Error('请逐项核对加载完整性；不确定请保持暂停');
        const pages = Number($('pages').value), rows = Number($('rows').value);
        if (!Number.isInteger(pages) || pages < 1 || pages > 30 || !Number.isInteger(rows) || rows < 1) throw new Error('请输入人工核对的末页1至30及正整数累计记录；0行请手动处理并停止本轮');
        guard(epoch); const s = snapshot();
        if (s.busy) throw new Error('仍检测到加载中，不能导出');
        if ((s.totalPages !== null && s.totalPages !== pages) || (s.page !== null && s.page !== pages) || (s.count !== null && s.count !== rows)) throw new Error('人工填写值与可读页码/记录数不一致，请先核对页面');
        state.manualReview = { pages, rows, at: new Date().toISOString(), category: categoryName(state.index) };
        state.stage = 'export'; save(); await run();
      });
    } else if (state.stage === 'download') {
      const entry = state.ledger[state.index];
      $('gate').innerHTML = `<p>${entry?.state === 'triggered' ? '已触发导出点击' : '已保存导出意图，点击或下载结果可能不明'}；助手不会重复点击。请在浏览器下载记录及下载目录中检查本类文件，必要时自行处理下拉菜单/保存框。</p>
        <label><input type="checkbox" id="downloadOK">我已确认本类文件下载成功，文件对应本类目、日期和累计记录</label>
        <button id="confirmDownload" class="accent">确认下载成功，进入下一类</button>`;
      $('confirmDownload').onclick = () => safeUI(async () => {
        if (!$('downloadOK').checked) throw new Error('只有确认文件下载成功后才能继续');
        guard(epoch); confirmDownload(state, new Date().toISOString()); save(); await run();
      });
    }
  }
  async function safeUI(fn) { try { await fn(); } catch (error) { pause(error.message); } }
  $('readRange').onclick = () => safeUI(async () => {
    if (active || lockHeld || state.status === 'running') throw new Error('切换日期前请先点击停止；暂停仍保留本轮锁');
    candidateRange = null; selectedRange = null; KEY = ''; corrupt = ''; state = initial(); $('rangeOK').checked = false;
    candidateRange = readPageRange(); note('请核对读取到的真实区间及周期；勾选后点击确认'); render();
  });
  $('useRange').onclick = () => safeUI(async () => {
    if (active || lockHeld || state.status === 'running') throw new Error('请先停止，再确认另一日期');
    if (!candidateRange || !$('rangeOK').checked) throw new Error('请先读取并勾选本次日期/周期核对');
    assertFrozen(candidateRange, readPageRange());
    selectedRange = candidateRange; candidateRange = null; KEY = checkpointKey(selectedRange);
    try { state = loadRangeState(selectedRange); corrupt = ''; }
    catch (error) { state = initial(selectedRange); corrupt = error.message; }
    state.status = 'idle'; note(corrupt || (state.legacyMigratedFrom ? '已预览旧版导出记录；开始后保存到独立新版键，旧键保留。先关闭旧分析窗' : '本次日期及周期已确认，点击开始/继续。刷新后需重新读取确认同一范围'));
    render();
  });
  $('start').onclick = start; $('resume').onclick = start;
  $('pause').onclick = () => pause();
  $('stop').onclick = () => {
    epoch++; state.status = 'stopped'; note('已停止后续操作，检查点保留；已开始的页面加载/下载不受助手控制');
    if (lockHeld) { try { save(); } catch (e) { state.reason += '；检查点保存失败：' + e.message; } }
    render(); releaseLock?.();
  };
  async function beginManual(stages) {
    if (active) throw new Error('请先暂停，等待观察循环退出');
    if (corrupt) throw new Error(corrupt);
    await acquire();
    if (!stages.includes(state.stage)) throw new Error('检查点阶段已变化，请按当前阶段操作');
    epoch++; state.status = 'running'; guard(epoch);
  }
  $('manualCategory').onclick = () => safeUI(async () => {
    await beginManual(['category', 'filters']); state.stage = 'filters'; save(); render();
  });
  $('manualOpen').onclick = () => safeUI(async () => {
    await beginManual(['open', 'openWait']); analysisDialog(); state.stage = 'load'; save(); await run();
  });
  $('manualLoad').onclick = () => safeUI(async () => {
    await beginManual(['load', 'observe']); state.evidence = newEvidence(snapshot(), Date.now()); state.stage = 'review';
    note('手动加载之前的基线未知，自动证据不充分；必须自行观察本次加载变化并确认末页'); save(); render();
  });
  $('manualClose').onclick = () => safeUI(async () => {
    await beginManual(['close', 'closeWait']); if (dialogs().length) throw new Error('仍有可见弹窗，请先关闭');
    nextCategory(state); save(); await run();
  });
  $('recheck').onclick = () => safeUI(async () => {
    if (active) throw new Error('请先暂停，等待观察循环退出');
    await acquire();
    if (state.ledger[state.index]) throw new Error('本类已有导出记录，不能回退重新分析');
    epoch++; state.status = 'running'; state.receipt = null; state.evidence = null;
    state.stage = 'filters'; note('请先关闭旧分析弹窗，再人工恢复正确筛选，重新核对后分析'); save(); render();
  });
  $('manualExport').onclick = () => safeUI(async () => {
    if (active) throw new Error('请先暂停，等待操作退出');
    await acquire();
    if (state.stage !== 'export') throw new Error('只有已通过完整性核对、停在准备导出阶段才可登记');
    epoch++; state.status = 'running'; guard(epoch);
    if (!confirm('助手将先保存导出意图。请随后自行点击当前类目的导出表格一次，并核对下载。登记后助手不会再自动导出此类目。继续？')) return;
    reserveExport(state, new Date().toISOString()); state.status = 'running'; epoch++;
    note('已登记手动导出意图；现在由你自行点击导出表格一次，成功后勾选下载确认'); save(); render();
  });
  $('reset').onclick = () => safeUI(async () => {
    if (active || state.status === 'running') throw new Error('请先停止本轮再新建');
    await acquire(true);
    if (!confirm('新建一轮会归档并重置当前日期+周期的检查点，可能重新下载17项；旧版键和其他日期记录保留。确定重新下载？')) { releaseLock?.(); return; }
    const previous = localStorage.getItem(KEY);
    if (previous) localStorage.setItem(KEY + ':backup:' + new Date().toISOString(), previous);
    epoch++; state = initial(selectedRange); state.mustCloseDialogs = true; corrupt = ''; save(); render(); releaseLock?.();
  });
  $('collapse').onclick = () => {
    const m = shadow.querySelector('main'); m.classList.toggle('hidden');
    $('collapse').textContent = m.classList.contains('hidden') ? '展开' : '收起';
  };
  // 标题栏拖动，不使用截图坐标选择页面控件。
  shadow.querySelector('header').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const head = e.currentTarget; head.setPointerCapture(e.pointerId);
    const move = ev => {
      host.style.transform = 'none'; host.style.bottom = 'auto';
      host.style.left = Math.max(0, Math.min(innerWidth - rect.width, ev.clientX - dx)) + 'px';
      host.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px';
    };
    const end = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', end); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', end, { once: true });
  });
  // 空闲人工阶段仍定期核查网址和可见筛选；不发出业务请求。
  setInterval(() => {
    if (state.status !== 'running') return;
    try { guard(epoch); } catch (error) { pause(error.message); }
  }, 1500);
  window.addEventListener('pagehide', () => { epoch++; releaseLock?.(); });
  render();
})();
