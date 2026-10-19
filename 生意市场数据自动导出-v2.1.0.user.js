// ==UserScript==
// @name         生意市场数据自动导出
// @namespace    local.waxiang.market-rank
// @version      2.1.0
// @description  面板配置时间，自动操作网页日期及17项类目；核对加载后导出，落盘人工确认；不自动启动。
// @match        https://sycm.taobao.com/mc/free/market_rank*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

/* 无依赖、无网络请求。DOM适配仅根据截图设计，未经目标现场验证。
 * 默认自动设置时间、切换并核对17项类目；控件缺失或歧义时暂停并支持点击标定。
 * 原生下载无法由普通用户脚本通用检测，必须逐类人工确认下载成功。
 *
 * 生意市场数据自动导出 v2.1.0（由已交付v2.0.0升级）
 * 本次更新：在面板选择7天/30天/日/周/月后点击开始，通过网页原生UI自动设置；
 * 日/周填具体日期（周填该周内任一日），月填YYYY-MM；最终只采用网站实际区间。
 * 类目默认自动按17项逐级切换，网页实际路径和任务目标分别显示，核对一致才分析。
 * 充分观察到加载变化/结束/明确末页/累计记录增长后可自动导出；证据不足才请求核对。
 * 日期+周期检查点、共享UI锁、旧版导出账本、导出前持久化和人工落盘确认全部保留。
 * 旧日期仅出现在旧版迁移代码中，不是新版运行限制。没有联网库或自动更新源。
 *
 * 手动使用：先停用旧名“生意参谋17类目导出助手（人工确认版）”脚本并刷新页面，
 * 将本完整文件装入Tampermonkey，在面板设置时间后开始；新装脚本不会自行开始。
 * 日历若无法识别，请展开“控件标定”，指定控件角色后点“标定下一次网页点击”。
 * 标定点击只选元素、阻止该次网页操作；随后点继续自动重试。只保存该元素选择器，
 * 不采集Cookie/Token或业务表格，不上传标定内容；不提供通用脚本执行/任意API入口。
 * 换时间配置须先停止并关闭旧分析窗；配置和导航阶段保存到本标签sessionStorage。
 * 页面重载后不自动点击；点继续会重新核对或有限次继续设置（每配置最多3次），不循环刷新。
 * 实时不作为稳定区间；日期读不到或URL/页面冲突会暂停，不用今天推算日期。
 * 日/周/月通用日历适配未经现场验证；无明确日期单元格、导航或当前路径即暂停，
 * 标定能补充可见输入框、弹层、类目触发器/完整路径等；仍不能核对时不能声称完成。
 * 暂停保留锁；停止释放锁。恢复/刷新不复用旧加载证据，已记录导出意图不自动重导出。
 * 新版保存到独立localStorage键；旧版键原样保留，旧范围+recent7可安全迁移。
 * “新建一轮”会明确确认并归档当前键，可能重新导出；不要中途清除站点存储。
 * 本交付只含一个JS；没有安装、注入或运行到用户业务页面，不能承诺无需DOM适配。
 */
(function () {
  'use strict';
  const SCRIPT_VERSION = '2.1.0';
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
  const SETUP_KEY = 'wx-market-rank-setup-v21';
  const CAL_KEY = 'wx-market-rank-calibration-v21';
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
  function normalizeConfig(input) {
    if (!['recent7', 'recent30', 'day', 'week', 'month'].includes(input?.mode)) throw new Error('请选择7天、30天、日、周或月');
    const mode = input.mode;
    const target = mode === 'day' || mode === 'week' ? normalizeDate(input.target || '') : mode === 'month' ? String(input.target || '').trim() : '';
    if (mode === 'month' && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(target)) throw new Error('月份必须为YYYY-MM，如2026-10');
    if (mode === 'month') normalizeDate(target + '-01');
    return { mode, target };
  }
  const configKey = c => JSON.stringify([c.mode, c.target]);
  function isoWeekForDate(value) {
    const date = new Date(normalizeDate(value) + 'T00:00:00Z');
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const year = date.getUTCFullYear(), first = Date.UTC(year, 0, 1);
    const week = Math.ceil(((date.getTime() - first) / 86400000 + 1) / 7);
    return year + '-W' + String(week).padStart(2, '0');
  }
  const rangeDays = r => Math.round((Date.parse(r.end + 'T00:00:00Z') - Date.parse(r.start + 'T00:00:00Z')) / 86400000) + 1;
  function matchesConfig(r, input) {
    const c = normalizeConfig(input);
    if (r.period.kind !== c.mode) return false;
    if (c.mode === 'recent7' || c.mode === 'recent30') return rangeDays(r) === (c.mode === 'recent7' ? 7 : 30);
    if (c.mode === 'day') return r.start === c.target && r.end === c.target;
    if (c.mode === 'week') return r.start <= c.target && c.target <= r.end && rangeDays(r) === 7;
    const [y, m] = c.target.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return r.start === c.target + '-01' && r.end === c.target + '-' + String(last).padStart(2, '0');
  }
  function categoryPath(text) {
    const flatten = s => norm(s).replace(/[>\/\\、|:：-]/g, '');
    const clean = flatten(text);
    const matches = CATEGORIES.map(c => [PRIMARY, ...c.filter(Boolean)]).filter(path => flatten(path.join('>')) === clean);
    return matches.length === 1 ? matches[0] : null;
  }
  function samePath(a, b) { return !!a && !!b && a.length === b.length && a.every((s, i) => norm(s) === norm(b[i])); }
  function assertCategory(actual, target) {
    if (!samePath(actual, target)) throw new Error(`网页当前类目${actual ? actual.join(' > ') : '无法核对完整路径'}与任务目标${target.join(' > ')}不一致，未开始分析`);
  }
  function nextTimeAttempt(progress) {
    const count = (progress?.attempts || 0) + 1;
    if (count > 3) throw new Error('本时间配置已尝试3次；为防止导航循环已暂停。请标定/修复缺失控件，再点击“重置时间尝试次数”');
    return { attempts: count, phase: 'mode', action: null };
  }
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
      else { if (!['category', 'filters'].includes(s.stage)) s.mustCloseDialogs = true; s.stage = 'category'; }
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
    return { version: VERSION, range, index: 0, stage: 'category', status: 'idle', reason: '在面板设置时间后开始；时间及类目默认自动操作', ledger: {}, evidence: null, receipt: null, log: [] };
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
    return { before: snapshot, last: snapshot, started: now, changed: false, sawBusy: false, sawBusyEnd: false, sawCountIncrease: false, sawPageProgress: false, maxPage: snapshot.page || 0, maxCount: snapshot.count || 0, samples: 0, quietSince: now };
  }
  function observe(e, s, now) {
    const changed = ['count', 'page', 'totalPages', 'busy', 'terminal'].some(k => s[k] !== e.last[k]);
    if (changed) { e.changed = true; e.quietSince = now; }
    if (s.busy) e.sawBusy = true;
    if (e.last.busy && !s.busy) e.sawBusyEnd = true;
    if (s.count !== null && e.last.count !== null && s.count > e.last.count) e.sawCountIncrease = true;
    if (s.page !== null && e.last.page !== null && s.page > e.last.page) e.sawPageProgress = true;
    e.maxPage = Math.max(e.maxPage, s.page || 0);
    e.maxCount = Math.max(e.maxCount, s.count || 0);
    e.last = s; e.samples++;
    return e;
  }
  function assessment(e, now) {
    const s = e.last;
    const pages = s.totalPages;
    const growth = pages === 1 || (e.sawCountIncrease && e.sawPageProgress);
    const candidate = e.changed && growth && e.sawBusy && e.sawBusyEnd && !s.busy && s.terminal && pages !== null && pages >= 1 && pages <= 30 && s.page === pages && s.count !== null && s.count > 0 && s.count >= e.maxCount && now - e.quietSince >= 20000;
    return { candidate, reason: candidate ? '检测到加载变化、累计记录增长、加载结束及明确末页；按这些DOM证据自动进入导出，落盘仍待人工确认' : '自动证据不足；需核对加载结束、实际末页、累计记录以及本次加载变化' };
  }
  const core = { SCRIPT_VERSION, norm, CATEGORIES, checkURL, normalizeDate, parseRange, periodKind, resolveRange, rangeIdentity, checkpointKey, normalizeConfig, configKey, isoWeekForDate, matchesConfig, categoryPath, samePath, assertCategory, nextTimeAttempt, assertFrozen, invalidateRange, legacyMatches, migrateLegacy, prepareRestored, unique, textCandidates, initial, validateState, reserveExport, assertControl, dispatchExport, confirmDownload, nextCategory, parseSnapshot, newEvidence, observe, assessment };
  // 仅供离线Node测试；浏览器分支不引入任何测试工具。
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (location.origin !== 'https://sycm.taobao.com' || location.pathname !== PATH || window.top !== window.self) return;
  if (document.getElementById('wx-rank-helper')) return;

  const ACTION_SELECTOR = 'button,[role="button"],a,input[type="button"],input[type="submit"],.ant-btn,.el-button';
  let state = initial(), KEY = '', selectedRange = null, candidateRange = null;
  let corrupt = '', active = false, epoch = 0, lockHeld = false, releaseLock = null;
  let rangeLockHeld = false, releaseRange = null, setupConfig = { mode: 'recent7', target: '' }, timeProgress = { attempts: 0, phase: 'idle' }, calibration = {};
  try {
    const raw = sessionStorage.getItem(SETUP_KEY);
    if (raw) {
      const setup = JSON.parse(raw); setupConfig = normalizeConfig(setup.config); timeProgress = setup.timeProgress || timeProgress;
      if (setup.range && setup.key === checkpointKey(setup.range)) {
        selectedRange = setup.range; KEY = setup.key; state = loadRangeState(selectedRange);
      } else { state.stage = 'time'; }
      state.status = 'idle'; state.reason = '已恢复本标签配置/阶段，未自动点击。点继续后先核对网站时间；旧加载证据不复用';
    }
    const cal = localStorage.getItem(CAL_KEY); if (cal) calibration = JSON.parse(cal);
  } catch (error) { state = initial(); KEY = ''; selectedRange = null; corrupt = '配置或标定记录损坏：' + error.message; }

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
      <p>设置时间后点击开始；助手自动操作网页原生日期控件，并采用网页实际计算结果。</p>
      <label>时间模式：<select id="timeMode"><option value="recent7">7天</option><option value="recent30">30天</option><option value="day">日（指定日期）</option><option value="week">周（填该周内任一日）</option><option value="month">月（指定月份）</option></select></label>
      <label id="targetLabel">指定日期/月份：<input id="timeTarget" type="date"></label>
      <button id="readRange">读取网页时间（诊断，不代替自动设置）</button>
      <p id="rangeDisplay"></p><p>一级类目：童装/婴儿装/亲子装</p>
      <p id="current"></p><p id="actualCategory"></p><p id="status"></p><p id="reason" class="warn"></p>
      <div><button id="start" class="accent">开始（自动设置时间）</button><button id="pause">暂停</button><button id="resume">继续检查点</button><button id="stop">停止</button></div>
      <p>可拖动标题栏或收起面板；所有下载均需逐类人工确认。</p>
      <div id="gate"></div>
      <details><summary>加载证据与导出记录</summary><div id="detail"></div></details>
      <details><summary>适配与恢复</summary>
        <p>默认自动切换类目并核对真实路径；控件歧义/无法核对时暂停。</p>
        <button id="manualCategory">重新自动切换并核对当前类目</button><button id="manualOpen">我已手动打开本类分析窗</button>
        <button id="manualLoad">我已手动点击加载全部</button><button id="manualClose">我已关闭本类分析窗</button>
        <button id="recheck">重新核对本类筛选</button><button id="manualExport">登记手动导出（先登记，后自行点击）</button>
        <p>仅在对应阶段可用；导出意图存在时不会回退到导出。结果不明请检查下载记录，必要时手动导出一次后确认。</p>
        <button id="reset">新建一轮（将清除本机本日期检查点）</button>
      </details>
      <details><summary>控件标定（只在自动识别失败时使用）</summary>
        <p>先暂停。选择角色，再点标定按钮，然后点网页上的对应控件。该次点击只记录控件选择器，不操作网页；之后点继续。日历/级联弹层可由你先手动打开一次再标定。</p>
        <select id="calRole"><option value="mode_recent7">网页7天按钮</option><option value="mode_recent30">网页30天按钮</option><option value="mode_day">网页日按钮</option><option value="mode_week">网页周按钮</option><option value="mode_month">网页月按钮</option><option value="dateInput">网页日期/周/月输入框或打开按钮</option><option value="datePopup">日历弹层容器</option><option value="categoryTrigger">切换类目的选择框/按钮</option><option value="categoryValue">显示当前完整类目路径的控件</option><option value="categoryPopup">三级类目弹层容器</option></select>
        <button id="markControl">标定下一次网页点击</button><button id="clearCalibration">清除本助手标定</button><button id="resetTimeAttempts">重置时间尝试次数</button><p id="calStatus"></p>
      </details>
    </main></section>`;
  document.documentElement.appendChild(host);
  const $ = id => shadow.getElementById(id);
  $('timeMode').value = setupConfig.mode; $('timeTarget').type = setupConfig.mode === 'month' ? 'month' : 'date'; $('timeTarget').value = setupConfig.target;

  function visible(e) {
    if (!e || !e.isConnected || e === host || host.contains(e)) return false;
    if (e.closest('[hidden],[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && [...e.getClientRects()].some(r => r.width > 0 && r.height > 0);
  }
  function enabled(e) { return !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[inert],.ant-picker-cell-disabled,.ant-calendar-disabled-cell,.el-date-table td.disabled') && !/(?:^|\s)(?:disabled|is-disabled|ant-btn-disabled)(?:\s|$)/.test(e.className || ''); }
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
  function analysisCloseButton(d) {
    const closers = [...d.querySelectorAll('button[aria-label],button[title],[role="button"][aria-label],.ant-modal-close,.el-dialog__headerbtn,.layui-layer-close')].filter(e => visible(e) && (/关闭|close/i.test((e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '')) || e.matches('.ant-modal-close,.el-dialog__headerbtn,.layui-layer-close')));
    return unique(closers, '已识别分析弹窗的关闭按钮', visible);
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
  function panelConfig() { return normalizeConfig({ mode: $('timeMode').value, target: $('timeTarget').value }); }
  function saveSetup() {
    sessionStorage.setItem(SETUP_KEY, JSON.stringify({ config: setupConfig, timeProgress, range: selectedRange, key: KEY, stage: state.stage, status: state.status }));
  }
  function calibrated(role, root = document) {
    const record = calibration[role]; if (!record) return null;
    if (typeof record.selector !== 'string' || record.selector.length > 2048) throw new Error(`标定“${role}”格式无效，请清除后重标`);
    let nodes;
    try { nodes = [...root.querySelectorAll(record.selector)].filter(visible); }
    catch { throw new Error(`标定“${role}”选择器已无效，请重标`); }
    const e = unique(nodes, `标定控件${role}（原位置已变化时请重标）`, visible);
    if (record.tag && e.tagName !== record.tag) throw new Error(`标定“${role}”控件类型变化，请重标`);
    const label = norm([e.innerText, e.getAttribute('aria-label'), e.getAttribute('title')].filter(Boolean).join(' '));
    if (['dateInput', 'categoryTrigger'].includes(role) && /导出|一键分析|加载全部|复制表格|批量取数|删除/.test(label)) throw new Error(`标定“${role}”指向业务操作按钮，已拒绝点击；请重新标定日期或类目控件`);
    if (role === 'dateInput') {
      const nativeDate = e.tagName === 'INPUT' && ['date', 'month', 'week'].includes(e.type);
      const semantic = /日期|时间|日历|月份|选择周|YYYY|yyyy/.test([e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.innerText].filter(Boolean).join(' '));
      const knownWrapper = e.closest('.ant-picker,.ant-calendar-picker,.el-date-editor');
      if (!nativeDate && !semantic && !knownWrapper) throw new Error('标定的日期控件缺少日期语义；请标定带日期占位文字的输入框或日历打开按钮');
      if (e.tagName === 'INPUT' && !['', 'text', 'date', 'month', 'week'].includes(e.type)) throw new Error('标定日期控件的输入类型不允许，未填写');
    }
    if (role === 'categoryTrigger' && !e.closest('.ant-cascader-picker,.el-cascader') && !/类目|分类|童装/.test(label)) throw new Error('标定类目触发器缺少类目语义；请标定“切换类目”旁的选择框或其外层');
    return e;
  }
  function leafNodes(nodes) { return nodes.filter(e => !nodes.some(other => e !== other && e.contains(other))); }
  function exactUI(root, label) {
    const nodes = textCandidates(root, label, 'button,a,[role="button"],[role="tab"],label,li,span,div', visible);
    return unique(leafNodes(nodes), label, visible);
  }
  function outsideAnalysis(e) { return !e.closest('[role="dialog"],.ant-modal,.el-dialog,.layui-layer,.ivu-modal'); }
  function pageBusy() {
    return [...mainScope().querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask')].some(e => visible(e) && outsideAnalysis(e));
  }
  function uiClick(e, label, token) {
    guard(token);
    if (!visible(e) || !enabled(e)) throw new Error(`“${label}”不可见或已禁用，未点击`);
    if (state.stage === 'time') timeProgress.action = label;
    else state.navigation = { ...(state.navigation || {}), action: label };
    save(); e.click(); assertControl(state.status, token, epoch, lockHeld);
  }
  function pickerRoot() {
    if (calibration.datePopup) return calibrated('datePopup');
    const all = [...document.querySelectorAll('.ant-picker-dropdown,.ant-calendar-picker-container,.el-picker-panel,.ant-calendar,[role="dialog"]')].filter(visible).filter(e => !norm(e.innerText).includes('市场排行_商品_'));
    return unique(all.filter(e => !all.some(parent => parent !== e && parent.contains(e))), '日期日历弹层；可在“控件标定”中标定日历容器', visible);
  }
  function dateInput() {
    if (calibration.dateInput) return calibrated('dateInput');
    const nodes = [...mainScope().querySelectorAll('input[type="date"],input[type="month"],.ant-calendar-picker-input,.ant-picker-input input,.el-date-editor input,input[placeholder*="日期"],input[placeholder*="月份"],input[placeholder*="选择周"]')].filter(e => visible(e) && outsideAnalysis(e));
    return unique(leafNodes(nodes), '网页日期/周/月输入框；可标定该输入框或打开按钮', visible);
  }
  function pickerCell(root, config) {
    const nodes = [...root.querySelectorAll('[role="gridcell"],td,button,[role="button"],a')].filter(e => visible(e) && enabled(e));
    const match = nodes.filter(e => {
      const labels = ['title', 'aria-label', 'data-date', 'data-month'].map(k => e.getAttribute(k) || '');
      return labels.some(text => {
        if (config.mode === 'month') { const [y, m] = config.target.split('-'); return new RegExp('^' + y + '[-/年]0?' + Number(m) + '月?$').test(text.trim()); }
        const dates = text.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g) || [];
        return dates.length === 1 && normalizeDate(dates[0]) === config.target;
      });
    });
    if (match.length > 1) return unique(leafNodes(match), '指定日期单元格', visible);
    return match[0] || null;
  }
  function calendarPosition(root) {
    const texts = [...root.querySelectorAll('.ant-picker-header-view,.ant-calendar-header,.el-date-picker__header,[aria-live="polite"]')].filter(visible).map(e => norm(e.innerText));
    const values = texts.map(t => {
      const full = t.match(/(\d{4})年(?:.*?)(\d{1,2})月/);
      if (full) return { year: +full[1], month: +full[2] };
      const year = t.match(/(\d{4})年/); return year ? { year: +year[1], month: null } : null;
    }).filter(Boolean);
    return unique([...new Map(values.map(v => [JSON.stringify(v), v])).values()], '日历当前年月标题（无法识别时可标定可编辑日期输入框）');
  }
  function calendarNav(root, direction, unit) {
    const aliases = direction > 0 ? unit === 'year' ? ['Next year', 'next-year', '下一年', '后一年'] : ['Next month', 'next-month', '下个月', '下一月', '下月'] : unit === 'year' ? ['Previous year', 'prev-year', '上一年', '前一年'] : ['Previous month', 'prev-month', '上个月', '上一月', '上月'];
    const nodes = [...root.querySelectorAll('button,[role="button"],a')].filter(e => visible(e) && enabled(e) && aliases.some(alias => [(e.getAttribute('aria-label') || ''), (e.getAttribute('title') || '')].some(s => norm(s).toLowerCase() === norm(alias).toLowerCase())));
    return unique(nodes, `日历${direction > 0 ? '下一' : '上一'}${unit === 'year' ? '年' : '月'}按钮（须有明确aria-label/title）`, visible);
  }
  async function chooseCalendar(config, token) {
    const input = dateInput();
    const currentValue = String(input.value || '');
    const isStandard = (config.mode === 'week' && input.type === 'week') || (config.mode !== 'week' && (input.type === 'date' || input.type === 'month' || /YYYY|yyyy/.test(input.getAttribute('placeholder') || '') || /^\d{4}-\d{2}(?:-\d{2})?$/.test(currentValue)));
    if (input.tagName === 'INPUT' && !input.readOnly && isStandard) {
      guard(token); if (!enabled(input)) throw new Error('网页日期输入框已禁用');
      timeProgress.phase = 'input'; timeProgress.action = '填写网页日期输入框'; save();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('当前浏览器不支持原生输入框赋值，请标定日历弹层');
      input.focus(); setter.call(input, config.mode === 'week' && input.type === 'week' ? isoWeekForDate(config.target) : config.target);
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); input.blur();
      await wait(500, token);
      // 有明确确认按钮时才点击；没有时以网页最终统计时间为准。
      const roots = [...document.querySelectorAll('.ant-picker-dropdown,.ant-calendar-picker-container,.el-picker-panel')].filter(visible);
      if (roots.length === 1) await confirmPicker(roots[0], token);
      return;
    }
    uiClick(input, '打开网页日期日历', token); await wait(400, token);
    for (let step = 0; step < 25; step++) {
      const root = pickerRoot(), cell = pickerCell(root, config);
      if (cell) { uiClick(cell, `选择${config.mode === 'month' ? '月份' : '日期'}${config.target}`, token); await wait(300, token); await confirmPicker(root, token); return; }
      const position = calendarPosition(root);
      const wanted = config.target.split('-').map(Number);
      const unit = config.mode === 'month' ? 'year' : 'month';
      const delta = unit === 'year' ? wanted[0] - position.year : position.month === null ? NaN : (wanted[0] - position.year) * 12 + wanted[1] - position.month;
      if (!Number.isFinite(delta) || delta === 0) throw new Error('日历已到目标年月，但缺少具有完整日期/月标记的可用单元格；请标定支持编辑的日期输入框或反馈脱敏控件DOM');
      if (Math.abs(delta) > 24) throw new Error('目标年月离当前日历超过24步，已暂停；请先定位附近月份或标定可编辑日期输入框');
      uiClick(calendarNav(root, Math.sign(delta), unit), '日历导航', token); await wait(250, token);
    }
    throw new Error('日历导航达到25步上限，已暂停防止循环');
  }
  async function confirmPicker(root, token) {
    if (!visible(root)) return;
    const all = ['确定', '确认', '应用'].flatMap(label => textCandidates(root, label, 'button,a,[role="button"]', visible));
    if (!all.length) return;
    uiClick(unique(all, '日历确认按钮', visible), '确认网页日期', token); await wait(400, token);
  }
  async function waitTimeResult(config, token) {
    const end = Date.now() + 30000; let previous = '', stable = 0, lastError = '尚未读到符合配置的网页区间';
    while (Date.now() < end) {
      guard(token);
      try {
        const r = readPageRange();
        if (!matchesConfig(r, config)) throw new Error(`网页实际${r.start}至${r.end}/${r.period.label}尚未符合面板配置`);
        if (pageBusy()) throw new Error('网页统计区域仍在加载');
        const key = rangeIdentity(r); stable = key === previous ? stable + 1 : 1; previous = key;
        if (stable >= 3) return r;
      } catch (error) { lastError = error.message; stable = 0; previous = ''; }
      await wait(700, token);
    }
    throw new Error('自动设置时间后无法核对最终网页区间：' + lastError + '。请标定缺失控件；未开始类目/导出');
  }
  async function configureTime(token) {
    if (dialogs().some(e => norm(e.innerText).includes('市场排行_商品_'))) {
      uiClick(analysisCloseButton(analysisDialog()), '关闭旧分析窗后设置新时间（旧导出账本保留）', token); await wait(400, token);
      if (dialogs().some(e => norm(e.innerText).includes('市场排行_商品_'))) throw new Error('旧分析窗关闭后仍存在，已暂停；不会复用旧窗');
    }
    let already = null;
    if (timeProgress.attempts > 0) { try { const r = readPageRange(); if (matchesConfig(r, setupConfig) && !pageBusy()) already = await waitTimeResult(setupConfig, token); } catch { /* 只读取；实际点击仍受次数限制 */ } }
    if (!already) {
      timeProgress = nextTimeAttempt(timeProgress); save(); render();
      const label = periodLabel(setupConfig.mode);
      const mode = calibrated('mode_' + setupConfig.mode) || exactUI(mainScope(), label);
      if (norm(mode.innerText || mode.textContent) !== norm(label)) throw new Error(`标定的时间按钮文字不是“${label}”，请重标`);
      uiClick(mode, `设置网页时间模式${label}`, token); timeProgress.phase = 'modeClicked'; save(); await wait(500, token);
      if (!['recent7', 'recent30'].includes(setupConfig.mode)) { timeProgress.phase = 'picker'; save(); await chooseCalendar(setupConfig, token); }
      timeProgress.phase = 'verify'; save(); already = await waitTimeResult(setupConfig, token);
    }
    guard(token);
    selectedRange = already; KEY = checkpointKey(already);
    await acquireRange();
    state = loadRangeState(already); state.config = { ...setupConfig }; state.status = 'running';
    state.categoryReceipt = null; state.receipt = null; state.evidence = null;
    timeProgress.phase = 'done'; note(`网页实际时间已核对：${already.start}至${already.end} / ${already.period.label}。开始自动类目流程`); save(); render();
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
    if (KEY && selectedRange) {
      if (!rangeLockHeld) throw new Error('未持有本日期/周期锁，禁止写入该检查点');
      localStorage.setItem(KEY, JSON.stringify(state));
    }
    saveSetup();
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
    const text = document.body.innerText;
    if (/请完成验证|拖动滑块|安全验证|访问受限|登录已失效|请重新登录/.test(text)) throw new Error('页面出现验证、访问限制或登录提示；请自行处理后继续');
    if (state.stage === 'time') return;
    try { assertFrozen(state.range, readPageRange()); }
    catch (error) { invalidateRange(state); state.categoryReceipt = null; throw error; }
    if (state.mustCloseDialogs) {
      if (dialogs().length) throw new Error('日期切换/旧版迁移后必须先手动关闭旧分析窗，禁止复用旧弹窗和加载证据');
      state.mustCloseDialogs = false;
    }
    if (!['category', 'filters', 'close', 'closeWait', 'done', 'download'].includes(state.stage)) verifyCurrentCategory();
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
  async function acquireUI() {
    if (lockHeld) return;
    if (!navigator.locks?.request) throw new Error('浏览器缺少Web Locks，无法保证多标签页不重复导出；请反馈浏览器版本');
    const locks = [GLOBAL_LOCK, LEGACY_KEY + '-exclusive'];
    await new Promise((resolve, reject) => {
      const take = async depth => {
        if (depth < locks.length) {
          return navigator.locks.request(locks[depth], { ifAvailable: true }, async lock => {
            if (!lock) throw new Error('另一个标签页或旧版助手正在操作该页面，请先在那里停止（不同日期也不能并发）');
            return take(depth + 1);
          });
        }
        try {
          lockHeld = true;
          await new Promise(done => { releaseLock = done; resolve(); });
        } finally { lockHeld = false; releaseLock = null; }
      };
      take(0).catch(reject);
    });
  }
  async function acquireRange() {
    if (rangeLockHeld) return;
    if (!lockHeld || !KEY || !selectedRange) throw new Error('日期锁申请前尚未持有UI锁/实际区间');
    const key = KEY;
    await new Promise((resolve, reject) => {
      navigator.locks.request(key + '-exclusive', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('当前日期+周期检查点已被另一实例占用');
        if (!lockHeld || KEY !== key || state.status !== 'running') throw new Error('日期锁申请时本轮已暂停/停止或配置改变');
        try { rangeLockHeld = true; await new Promise(done => { releaseRange = done; resolve(); }); }
        finally { rangeLockHeld = false; releaseRange = null; }
      }).catch(reject);
    });
  }
  async function acquire(allowCorrupt = false) {
    if (lockHeld && rangeLockHeld) return;
    if (!selectedRange || !KEY) throw new Error('尚未自动设置并核对网页日期，请从开始/继续启动时间配置');
    await acquireUI();
    const previousStatus = state.status; state.status = 'running';
    try {
      assertFrozen(selectedRange, readPageRange()); await acquireRange();
      try { state = loadRangeState(selectedRange); } catch (error) { if (!allowCorrupt) throw error; }
    } catch (error) { state.status = previousStatus; throw error; }
  }
  function releaseAll() { releaseRange?.(); releaseLock?.(); }
  async function wait(ms, token) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, Math.min(500, until - Date.now())));
      guard(token);
    }
  }
  function categoryTrigger() {
    if (calibration.categoryTrigger) return calibrated('categoryTrigger');
    const root = mainScope();
    const labels = leafNodes(textCandidates(root, '切换类目', 'button,a,label,span,div', visible));
    if (labels.length > 1) throw new Error('“切换类目”有多个可见候选，请标定类目选择框');
    if (labels.length === 1) {
      let scope = labels[0].parentElement;
      for (let depth = 0; scope && depth < 3; depth++, scope = scope.parentElement) {
        const controls = leafNodes([...scope.querySelectorAll('.ant-cascader-picker,.el-cascader,[role="combobox"]')].filter(visible));
        if (controls.length === 1) return controls[0];
        if (controls.length > 1) throw new Error('切换类目附近有多个选择框，请标定正确类目控件');
      }
      return labels[0];
    }
    return unique(leafNodes([...root.querySelectorAll('.ant-cascader-picker,.el-cascader')].filter(visible)), '类目级联选择框（可标定“切换类目”旁控件）', visible);
  }
  function categoryPopup(optional = false) {
    if (calibration.categoryPopup) {
      if (optional) { const nodes = [...document.querySelectorAll(calibration.categoryPopup.selector)].filter(visible); if (!nodes.length) return null; }
      return calibrated('categoryPopup');
    }
    const nodes = [...document.querySelectorAll('.ant-cascader-menus,.el-cascader-panel,[role="tree"]')].filter(visible);
    if (optional && !nodes.length) return null;
    return unique(nodes.filter(e => !nodes.some(other => other !== e && other.contains(e))), '可见类目级联弹层（可标定弹层容器）', visible);
  }
  function categoryColumns(popup) { return [...popup.querySelectorAll('.ant-cascader-menu,.el-cascader-menu,[role="group"]')].filter(visible); }
  function optionLabel(e) {
    const children = [...e.querySelectorAll('.ant-cascader-menu-item-content,.el-cascader-node__label')].filter(visible);
    return (children.length === 1 ? children[0].innerText : e.innerText || e.textContent || '').trim();
  }
  function currentCategory() {
    const trigger = categoryTrigger();
    const group = trigger.closest('.ant-cascader-picker,.el-cascader') || trigger;
    const value = calibration.categoryValue ? calibrated('categoryValue') : null;
    const controls = value ? [value] : [group, ...group.querySelectorAll('input,.ant-cascader-picker-label,.el-input__inner,[aria-valuetext],[title]')].filter(visible);
    const texts = [...new Set(controls.flatMap(e => [e.value, e.getAttribute('title'), e.getAttribute('aria-valuetext'), e.innerText]).filter(t => typeof t === 'string' && t.trim() && t.length < 220).map(t => t.trim()))];
    const paths = [...new Map(texts.map(categoryPath).filter(Boolean).map(path => [path.join('>'), path])).values()];
    if (paths.length > 1) throw new Error('网页当前类目显示多个不同完整路径，请标定唯一的当前类目显示控件');
    return { path: paths[0] || null, display: paths[0] ? paths[0].join(' > ') : texts.join(' | ') || '未读到选中值', texts, signature: JSON.stringify(texts), marker: new URL(location.href).searchParams.get('cateId') || '' };
  }
  function verifyCurrentCategory() {
    const observed = currentCategory(), target = [PRIMARY, ...CATEGORIES[state.index].filter(Boolean)];
    let path = observed.path;
    const receipt = state.categoryReceipt;
    if (!path && receipt && receipt.signature === observed.signature && receipt.marker === observed.marker && observed.texts.some(text => norm(text).includes(norm(receipt.path.at(-1))))) path = receipt.path;
    assertCategory(path, target);
    return { ...observed, path };
  }
  function popupSelectedPath(popup) {
    const columns = categoryColumns(popup), path = [];
    if (columns.length < 2 || columns.length > 3) throw new Error('无法识别级联类目的一/二/三级列，请标定三级弹层容器');
    for (let level = 0; level < columns.length; level++) {
      const nodes = [...columns[level].querySelectorAll('[aria-selected="true"],[aria-checked="true"],.ant-cascader-menu-item-active,.ant-cascader-menu-item-expand,.el-cascader-node.is-active,.el-cascader-node.in-active-path')].filter(e => visible(e) && optionLabel(e));
      if (!nodes.length && level === 2) break;
      const chosen = unique(leafNodes(nodes), `类目第${level + 1}列当前已选/已展开路径标记；可标定完整当前路径显示控件`, visible);
      path.push(optionLabel(chosen));
    }
    return path;
  }
  async function tryCategory(token) {
    const target = [PRIMARY, ...CATEGORIES[state.index].filter(Boolean)];
    let observed = currentCategory();
    if (samePath(observed.path, target)) {
      if (categoryPopup(true)) { uiClick(categoryTrigger(), '收起类目弹层', token); await wait(350, token); }
      if (categoryPopup(true)) throw new Error('当前路径已匹配，但类目弹层无法收起，请标定触发器');
      observed = currentCategory(); assertCategory(observed.path, target);
      state.categoryReceipt = { path: observed.path, signature: observed.signature, marker: observed.marker };
      state.stage = 'filters'; save(); return;
    }
    state.categoryReceipt = null; state.receipt = null;
    const old = state.navigation?.index === state.index ? state.navigation : { index: state.index, attempts: 0 };
    if (old.attempts >= 3) throw new Error('本类目已自动尝试3次，已暂停防循环；请标定相关控件后再继续');
    state.navigation = { index: state.index, attempts: old.attempts + 1, level: 0 }; save();
    const trigger = categoryTrigger();
    if (!categoryPopup(true)) { uiClick(trigger, '打开切换类目级联框', token); await wait(400, token); }
    for (let level = 0; level < target.length; level++) {
      const popup = categoryPopup(), columns = categoryColumns(popup);
      if (!columns[level]) throw new Error(`缺少类目第${level + 1}列；请标定正确的级联弹层容器`);
      const items = [...columns[level].querySelectorAll('[role="menuitem"],[role="treeitem"],li')].filter(e => visible(e) && norm(optionLabel(e)) === norm(target[level]));
      const candidate = unique(leafNodes(items), `第${level + 1}级类目“${target[level]}”`, visible);
      state.navigation.level = level; uiClick(candidate, `选择第${level + 1}级${target[level]}`, token); await wait(500, token);
    }
    observed = currentCategory(); let actual = observed.path;
    if (!actual) {
      let popup = categoryPopup(true);
      if (!popup) { uiClick(categoryTrigger(), '重新展开以核对已选类目路径', token); await wait(350, token); popup = categoryPopup(); }
      actual = popupSelectedPath(popup);
    }
    assertCategory(actual, target);
    if (categoryPopup(true)) { uiClick(categoryTrigger(), '收起已核对的类目弹层', token); await wait(350, token); }
    if (categoryPopup(true)) throw new Error('类目弹层未收起，已暂停；请检查触发器标定');
    observed = currentCategory();
    if (!observed.path && !observed.texts.some(text => norm(text).includes(norm(actual.at(-1))))) throw new Error('级联路径虽已读取，但主页面选中值不能证明已采用该类目；请标定当前完整类目显示控件');
    state.categoryReceipt = { path: actual, signature: observed.signature, marker: observed.marker };
    verifyCurrentCategory(); state.stage = 'filters'; note('网页真实类目路径已与任务目标核对一致'); save(); render();
  }
  async function run() {
    if (active) return;
    active = true;
    const token = epoch;
    try {
      while (state.status === 'running') {
        guard(token); render();
        if (state.stage === 'category') {
          await tryCategory(token); continue;
        }
        if (state.stage === 'filters') {
          verifyCurrentCategory(); state.receipt = { signature: filterSignature(), confirmedAt: new Date().toISOString(), automatic: true };
          state.stage = 'open'; save(); continue;
        }
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
          if ((before.totalPages !== null && before.totalPages > 30) || (before.page !== null && before.page > 30)) throw new Error('弹窗显示超过30页，未点击加载全部；请先把插件加载范围限制到最多30页，助手不会猜测插件设置');
          if (before.busy) throw new Error('弹窗已在加载，请勿再次点击加载全部；可手动接管观察');
          state.evidence = newEvidence(before, Date.now());
          clickOnce(action(d, '加载全部'), 'observe', token); continue;
        }
        if (state.stage === 'observe') {
          if (!state.evidence) throw new Error('缺少加载前的观察基线，请手动接管并核对本次加载变化');
          const currentLoad = snapshot();
          if ((currentLoad.totalPages !== null && currentLoad.totalPages > 30) || (currentLoad.page !== null && currentLoad.page > 30)) throw new Error('加载中发现超过30页，已暂停助手后续操作；网页自身加载可能继续，请自行停止并核对插件范围');
          observe(state.evidence, currentLoad, Date.now()); save();
          const a = assessment(state.evidence, Date.now());
          if (a.candidate) { state.stage = 'export'; state.autoReview = { at: new Date().toISOString(), evidence: JSON.parse(JSON.stringify(state.evidence.last)) }; note(a.reason); save(); continue; }
          if (Date.now() - state.evidence.started > 12 * 60 * 1000) { state.stage = 'review'; note(a.reason); save(); render(); return; }
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
          clickOnce(analysisCloseButton(d), 'closeWait', token);
          await wait(500, token); continue;
        }
        if (state.stage === 'closeWait') {
          if (dialogs().length) throw new Error('仍有可见弹窗，请手动关闭后继续');
          nextCategory(state); save(); continue;
        }
        if (state.stage === 'done') {
          state.status = 'done'; note('17项均已由你人工确认下载成功。请保留导出文件并自行检查内容'); save(); render(); releaseAll(); return;
        }
      }
    } catch (error) { if (state.status === 'running' && token === epoch) pause(error.message); }
    finally { active = false; render(); }
  }
  async function start(resume = false) {
    const beforeEpoch = epoch;
    try {
      if (corrupt) throw new Error(corrupt);
      if (active) throw new Error('前一轮异步观察正在退出，请稍后再继续');
      const requested = panelConfig();
      if (resume && selectedRange && state.stage !== 'time' && configKey(requested) === configKey(setupConfig)) {
        await acquire(); state.status = 'running'; state.config = { ...setupConfig }; epoch++; save(); render(); await run(); return;
      }
      if (lockHeld && (!resume || configKey(requested) !== configKey(setupConfig))) throw new Error('重新设置时间或更改配置前必须先停止本轮');
      await acquireUI();
      if (rangeLockHeld) throw new Error('仍持有旧日期锁，请先停止再设置新时间');
      if (!resume || configKey(requested) !== configKey(setupConfig)) timeProgress = { attempts: 0, phase: 'idle' };
      setupConfig = requested; KEY = ''; selectedRange = null; candidateRange = null;
      state = initial(); state.stage = 'time'; state.status = 'running'; epoch++;
      save(); render(); active = true; const token = epoch;
      try { await configureTime(token); } finally { active = false; render(); }
      if (state.status === 'running') await run();
    } catch (error) { if (!['paused', 'stopped'].includes(state.status) || epoch === beforeEpoch) pause(error.message); else render(); }
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const labels = { time: '自动设置并核对网页时间', category: '自动切换并核对类目', filters: '自动核对筛选', open: '打开分析', openWait: '核对分析窗', load: '加载全部', observe: '观察加载变化', review: '加载证据不足，需核对末页和记录数', export: '准备导出', download: '待人工确认下载', close: '关闭分析窗', closeWait: '核对关闭', done: '完成' };
  function render() {
    const showRange = candidateRange || selectedRange;
    $('rangeDisplay').textContent = showRange ? `${candidateRange ? '网页诊断读取（尚未启动自动设置）' : '本轮网站实际区间'}：${showRange.start} 至 ${showRange.end} · ${showRange.period.label} · ${showRange.source}` : '开始后自动设置网页时间并读取实际区间；最近7/30天由网站计算。';
    $('current').textContent = `任务目标类目 ${Math.min(state.index + 1, 17)} / 17：${categoryName(state.index)}`;
    try {
      const current = currentCategory();
      const verified = current.path || (state.categoryReceipt?.signature === current.signature && state.categoryReceipt.marker === current.marker ? state.categoryReceipt.path : null);
      $('actualCategory').textContent = '网页当前类目：' + (verified ? verified.join(' > ') : current.display + '（完整路径未核对）');
    } catch (error) { $('actualCategory').textContent = '网页当前类目：未识别；' + error.message; }
    $('status').textContent = `${state.status} · ${labels[state.stage]}`;
    $('reason').textContent = state.reason;
    const running = state.status === 'running';
    $('readRange').disabled = active || running;
    $('timeMode').disabled = active || lockHeld || running;
    $('timeTarget').disabled = active || lockHeld || running;
    $('targetLabel').style.display = ['recent7', 'recent30'].includes($('timeMode').value) ? 'none' : 'block';
    $('start').disabled = active || running || lockHeld || !!corrupt;
    $('resume').disabled = active || running || !!corrupt || state.stage === 'done';
    $('pause').disabled = !running;
    $('manualCategory').disabled = !selectedRange || active || !['category', 'filters'].includes(state.stage);
    $('manualOpen').disabled = !selectedRange || active || !['open', 'openWait'].includes(state.stage);
    $('manualLoad').disabled = !selectedRange || active || !['load', 'observe'].includes(state.stage);
    $('manualClose').disabled = !selectedRange || active || !['close', 'closeWait'].includes(state.stage);
    $('recheck').disabled = !selectedRange || active || !!state.ledger[state.index] || state.stage === 'done';
    $('manualExport').disabled = active || state.stage !== 'export' || !!state.ledger[state.index];
    $('markControl').disabled = active || running; $('clearCalibration').disabled = active || running; $('resetTimeAttempts').disabled = active || running;
    const e = state.evidence;
    $('detail').textContent = (e ? `本次加载后变化：${e.changed}\n见过加载中：${e.sawBusy}\n见过加载结束：${e.sawBusyEnd}\n可读当前页最大值：${e.maxPage || '未知'}\n当前页：${e.last.page ?? '未知'} / 明确总页数：${e.last.totalPages ?? '未知'}\n累计记录：${e.last.count ?? '未知'}\n明确末页/完成文本：${e.last.terminal}\n${assessment(e, Date.now()).reason}\n注意：页数和行数稳定不能证明完整。\n\n` : '') + JSON.stringify(state.ledger, null, 2);
    // 不在相同阶段反复重建人工表单，避免轮询清空用户输入。
    const gateKey = `${KEY}:${state.index}:${state.stage}:${running}`;
    if ($('gate').dataset.key === gateKey) return;
    $('gate').dataset.key = gateKey;
    $('gate').innerHTML = '';
    if (!running) return;
    if (state.stage === 'time') {
      $('gate').textContent = `正在自动设置${periodLabel(setupConfig.mode)}${setupConfig.target ? ' / ' + setupConfig.target : ''}，阶段：${timeProgress.phase}，尝试${timeProgress.attempts}/3。未核对成功前不进行类目或导出。`;
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
    if (active || state.status === 'running') throw new Error('请先暂停再诊断读取');
    candidateRange = readPageRange(); note('仅显示网页当前实际时间，未替代面板自动时间设置，也未切换本轮检查点'); render();
  });
  $('start').onclick = () => start(false); $('resume').onclick = () => start(true);
  $('pause').onclick = () => pause();
  $('stop').onclick = () => {
    epoch++; state.status = 'stopped'; note('已停止后续操作，检查点保留；已开始的页面加载/下载不受助手控制');
    if (lockHeld) { try { save(); } catch (e) { state.reason += '；检查点保存失败：' + e.message; } }
    render(); releaseAll();
  };
  async function beginManual(stages) {
    if (active) throw new Error('请先暂停，等待观察循环退出');
    if (corrupt) throw new Error(corrupt);
    await acquire();
    if (!stages.includes(state.stage)) throw new Error('检查点阶段已变化，请按当前阶段操作');
    epoch++; state.status = 'running'; guard(epoch);
  }
  $('manualCategory').onclick = () => safeUI(async () => {
    await beginManual(['category', 'filters']); state.stage = 'category'; state.receipt = null; state.categoryReceipt = null; save(); await run();
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
    state.stage = 'category'; state.categoryReceipt = null; note('重新自动切换并核对本类目；筛选由分析窗标题核对'); save(); await run();
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
    if (!confirm('新建一轮会归档并重置当前日期+周期的检查点，可能重新下载17项；旧版键和其他日期记录保留。确定重新下载？')) { releaseAll(); return; }
    const previous = localStorage.getItem(KEY);
    if (previous) localStorage.setItem(KEY + ':backup:' + new Date().toISOString(), previous);
    epoch++; state = initial(selectedRange); state.mustCloseDialogs = true; corrupt = ''; save(); render(); releaseAll();
  });
  function changeConfig() {
    if (active || lockHeld || state.status === 'running') { pause('运行中不能变更时间配置；请先停止，再设置新时间'); return; }
    const mode = $('timeMode').value;
    $('timeTarget').type = mode === 'month' ? 'month' : 'date';
    KEY = ''; selectedRange = null; candidateRange = null; state = initial(); corrupt = ''; timeProgress = { attempts: 0, phase: 'idle' };
    try { setupConfig = panelConfig(); saveSetup(); note('新配置已保存；点击开始后自动设置网页时间，旧日期账本保留'); }
    catch (error) { note(error.message + '；填好后点击开始'); }
    render();
  }
  $('timeMode').onchange = changeConfig; $('timeTarget').onchange = changeConfig;
  function selectorFor(e) {
    if (!e || e.nodeType !== 1 || !visible(e)) throw new Error('所选控件不可见或不是网页元素');
    const esc = s => CSS.escape(String(s));
    if (e.id) { const selector = '#' + esc(e.id); if (document.querySelectorAll(selector).length === 1) return selector; }
    for (const attr of ['aria-label', 'placeholder', 'title', 'data-testid']) {
      const value = e.getAttribute(attr);
      if (!value || value.length > 120) continue;
      const selector = e.tagName.toLowerCase() + `[${attr}="${esc(value)}"]`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = []; let node = e;
    for (let level = 0; node && node.nodeType === 1 && level < 8; level++, node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement ? [...node.parentElement.children].filter(x => x.tagName === node.tagName) : [node];
      parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
      const selector = parts.join(' > ');
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    throw new Error('无法生成唯一的控件选择器，请选择更具体的控件');
  }
  let cancelMark = null;
  $('markControl').onclick = () => safeUI(async () => {
    if (active || state.status === 'running') throw new Error('先暂停，等待当前异步操作退出后再标定');
    cancelMark?.();
    const role = $('calRole').value;
    const roles = ['mode_recent7', 'mode_recent30', 'mode_day', 'mode_week', 'mode_month', 'dateInput', 'datePopup', 'categoryTrigger', 'categoryValue', 'categoryPopup'];
    if (!roles.includes(role)) throw new Error('未知的标定角色');
    $('calStatus').textContent = '等待你点击网页对应控件；按Esc取消。本次点击不会执行网页动作。';
    const cancel = () => { document.removeEventListener('pointerdown', pick, true); document.removeEventListener('keydown', key, true); cancelMark = null; };
    const key = event => { if (event.key === 'Escape') { cancel(); $('calStatus').textContent = '已取消标定'; } };
    const pick = event => {
      let e = event.composedPath?.()[0] || event.target;
      if (e === host || e?.getRootNode?.() === shadow) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const blockClick = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); document.removeEventListener('click', blockClick, true); };
      document.addEventListener('click', blockClick, true); setTimeout(() => document.removeEventListener('click', blockClick, true), 2000);
      cancel();
      try {
        if (role === 'datePopup') e = e.closest('.ant-picker-dropdown,.ant-calendar-picker-container,.el-picker-panel,[role="dialog"]') || e;
        else if (role === 'categoryPopup') e = e.closest('.ant-cascader-menus,.el-cascader-panel,[role="tree"]') || e;
        else if (role !== 'categoryValue') e = e.closest('input,button,a,[role="button"],.ant-cascader-picker,.el-cascader') || e;
        const selector = selectorFor(e);
        calibration[role] = { selector, tag: e.tagName };
        localStorage.setItem(CAL_KEY, JSON.stringify(calibration));
        timeProgress = { attempts: 0, phase: 'idle' }; if (state.navigation) state.navigation.attempts = 0;
        if (lockHeld) save(); else saveSetup();
        $('calStatus').textContent = `已标定${role}：${e.tagName}；点继续自动操作并核对最终结果。选择器失效或歧义会再次暂停。`;
      } catch (error) { pause(error.message); }
    };
    cancelMark = cancel; document.addEventListener('pointerdown', pick, true); document.addEventListener('keydown', key, true);
  });
  $('clearCalibration').onclick = () => safeUI(async () => {
    if (active || state.status === 'running') throw new Error('请先暂停再清除标定');
    cancelMark?.(); calibration = {}; localStorage.removeItem(CAL_KEY); $('calStatus').textContent = '已清除本助手控件标定，恢复语义DOM自动识别';
  });
  $('resetTimeAttempts').onclick = () => safeUI(async () => {
    if (active || state.status === 'running') throw new Error('请先暂停再重置尝试次数');
    timeProgress = { attempts: 0, phase: 'idle' }; if (state.navigation) state.navigation.attempts = 0;
    if (lockHeld) save(); else saveSetup();
    note('时间及本类导航尝试次数已重置；继续时仍须唯一控件及实际结果核对'); render();
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
  window.addEventListener('pagehide', () => { epoch++; cancelMark?.(); releaseAll(); });
  render();
})();
