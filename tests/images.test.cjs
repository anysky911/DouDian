const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML, DOMParser } = require('linkedom');
const { collect, cardImage, imageUrl, detailImage, prepareImages, xlsx } = require('../tmall-new-products.user.js');
const main = 'https://img.alicdn.com/main.jpg';

test('商品卡片主图与ID绑定，排除SKU缩略图、图标和相邻商品，兼容懒加载', () => {
  const { document } = parseHTML(`<html><body>
    <a class="shop-item-card" href="//detail.tmall.com/item.htm?id=834317211932">
      <img class="thumb--abc" width="36" height="36" src="https://img.alicdn.com/sku.jpg">
      <img width="460" height="460" src="data:image/gif;base64,AAAA" data-src="${main}">
      <div class="title--abc" title="儿童运动套装"><img width="48" height="12" src="https://img.alicdn.com/logo.png">儿童运动套装</div>
    </a>
    <a class="shop-item-card" href="//detail.tmall.com/item.htm?id=222222222">
      <img width="400" height="400" src="https://img.alicdn.com/second.jpg">
      <div class="title--abc">另一件儿童上衣</div>
    </a></body></html>`);
  const items = collect(document).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, '834317211932');
  assert.equal(items[0].image, main);
  assert.equal(items[1].image, 'https://img.alicdn.com/second.jpg');
  const onlyThumb = parseHTML('<div><img class="thumb--abc" width="460" height="460" src="https://img.alicdn.com/wrong.jpg"></div>').document;
  assert.equal(cardImage(onlyThumb), '');
  const nested = parseHTML('<div id="outer"><div data-item-id="999999999"><img width="460" height="460" src="https://img.alicdn.com/wrong.jpg"></div></div>').document;
  assert.equal(cardImage(nested.querySelector('#outer')), '');
});

test('缺图旧数据可读详情主图；只接受有效图片CDN地址', () => {
  const { document } = parseHTML(`<img id="mainPicImageEl" src="//img.alicdn.com/main.jpg">`);
  assert.equal(detailImage(document), main);
  for (const raw of ['', undefined, 'undefined', '/photo.jpg', 'javascript:alert(1)', 'https://img.alicdn.com.evil.example/a.jpg']) assert.equal(imageUrl(raw), '');
});

test('单张下载失败不阻断导出，按商品ID去重，停止不再下载后续图片', async () => {
  const rows = [{ id: '1', image: main }, { id: '2', image: 'https://img.alicdn.com/bad.jpg' }, { id: '3' }, { id: '1', image: main }];
  const calls = [];
  const result = await prepareImages(rows, async url => {
    calls.push(url);
    if (url.includes('bad')) throw Error('404');
    return { bytes: Uint8Array.of(255, 216, 255, 217), width: 240, height: 120 };
  });
  assert.equal(calls.length, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.images.size, 1);
  let stop = false, count = 0;
  await assert.rejects(prepareImages(rows, async () => { count++; stop = true; return {}; }, () => {}, () => stop), /停止/);
  assert.equal(count, 1);
});

function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = {};
  let p = 0;
  while (buffer.readUInt32LE(p) === 0x04034b50) {
    const size = buffer.readUInt32LE(p + 18), length = buffer.readUInt16LE(p + 26), extra = buffer.readUInt16LE(p + 28);
    const name = buffer.subarray(p + 30, p + 30 + length).toString();
    const start = p + 30 + length + extra;
    files[name] = buffer.subarray(start, start + size);
    p = start + size;
  }
  return files;
}

test('XLSX图片字节不损坏、关系完整、锚定对应行C列，比例和后续列正确', () => {
  const jpeg = Uint8Array.of(255, 216, 0, 128, 255, 217);
  const rows = [
    { id: '100000001', shop: '店铺', title: '横图', sku: 'IN12345', url: '商品链接1' },
    { id: '100000002', shop: '店铺', title: '失败留空', sku: 'IN23456', url: '商品链接2' },
    { id: '100000003', shop: '店铺', title: '竖图', sku: 'IN34567', url: '商品链接3' }
  ];
  const files = unzip(xlsx(rows, new Map([
    ['100000001', { bytes: jpeg, width: 240, height: 120 }],
    ['100000003', { bytes: jpeg, width: 120, height: 240 }]
  ])));
  assert.deepEqual(files['xl/media/image1.jpg'], Buffer.from(jpeg));
  assert.deepEqual(files['xl/media/image2.jpg'], Buffer.from(jpeg));
  const parse = name => new DOMParser().parseFromString(files[name].toString(), 'text/xml');
  const sheet = parse('xl/worksheets/sheet1.xml');
  const cell = ref => sheet.querySelector(`c[r="${ref}"]`).textContent;
  assert.deepEqual(['C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'].map(cell), ['图片', '货号', '标题结果', '货号结果', '数字', '商品链接', '商品ID']);
  assert.equal(cell('D4'), 'IN34567');
  assert.equal(cell('I4'), '100000003');
  assert.equal(cell('H4'), '商品链接3');
  for (const col of ['C', 'E', 'F', 'G']) for (const r of [2, 3, 4]) assert.equal(cell(col + r), '');
  assert.equal(sheet.querySelector('autoFilter').getAttribute('ref'), 'A1:M4');
  assert.equal(sheet.querySelectorAll('col').length, 13);
  assert.ok(Number(sheet.querySelector('row[r="2"]').getAttribute('ht')) >= 84);
  const drawing = parse('xl/drawings/drawing1.xml');
  const anchors = [...drawing.getElementsByTagName('xdr:twoCellAnchor')];
  assert.equal(anchors.length, 2);
  anchors.forEach((anchor, i) => {
    assert.equal(anchor.getAttribute('editAs'), 'twoCell');
    const from = anchor.getElementsByTagName('xdr:from')[0];
    assert.equal(from.getElementsByTagName('xdr:col')[0].textContent, '2');
    assert.equal(from.getElementsByTagName('xdr:row')[0].textContent, i === 0 ? '1' : '3');
    const extent = anchor.getElementsByTagName('a:ext')[0];
    assert.equal(Number(extent.getAttribute('cx')) / Number(extent.getAttribute('cy')), i === 0 ? 2 : .5);
  });
  assert.ok(files['[Content_Types].xml'].toString().includes('image/jpeg'));
  assert.ok(files['xl/worksheets/_rels/sheet1.xml.rels'].toString().includes('../drawings/drawing1.xml'));
  assert.ok(files['xl/drawings/_rels/drawing1.xml.rels'].toString().includes('../media/image2.jpg'));
  const empty = unzip(xlsx(rows));
  assert.equal(empty['xl/drawings/drawing1.xml'], undefined);
  assert.ok(!empty['xl/worksheets/sheet1.xml'].toString().includes('<drawing '));
});

test('详情标签打不开、缺图时仍可通过导出按钮下载并报告失败数', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const { document } = parseHTML('<html><head><title>测试店</title></head><body></body></html>');
  const saved = new Map([['doudian.product.v1.amencl.tmall.com.834317211932', {
    shop: '测试店', title: '运动套装', id: '834317211932',
    url: 'https://detail.tmall.com/item.htm?id=834317211932', shopUrl: 'https://amencl.tmall.com/', time: '2026-10-20'
  }]]);
  let downloaded = '';
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'a') element.click = () => { downloaded = element.download; };
    return element;
  };
  class TestURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../tmall-new-products.user.js'), 'utf8'), {
    document, location: new URL('https://amencl.tmall.com/'), URL: TestURL, URLSearchParams, Intl, TextEncoder, Date, Blob,
    window: { addEventListener() {} }, setInterval() {}, setTimeout: fn => fn(),
    GM_getValue: (key, fallback) => saved.has(key) ? saved.get(key) : fallback,
    GM_listValues: () => [...saved.keys()], GM_setValue: (key, value) => saved.set(key, value),
    GM_openInTab() { throw Error('模拟无法打开详情页'); }
  });
  const ui = document.getElementById('doudian-collector').shadowRoot;
  await ui.getElementById('export').onclick();
  assert.match(decodeURIComponent(downloaded), /^测试店_全部宝贝_\d{8}-\d{6}\.xlsx$/);
  assert.match(ui.getElementById('status').textContent, /失败或缺图 1 行；详情未读到 1 个/);
  assert.equal(ui.getElementById('export').disabled, false);
});
