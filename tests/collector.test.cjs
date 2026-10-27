const test = require('node:test');
const assert = require('node:assert/strict');
const { productUrl, fromProps, csv, csvCell, collect, limitNewItems, xlsx, exportName } = require('../tmall-new-products.user.js');
const { parseHTML } = require('linkedom');

test('规范商品链接，剔除跟踪参数，拒绝非商品域名和无效ID', () => {
  assert.deepEqual(productUrl('//detail.tmall.com/item.htm?id=123456789&spm=tracking'), { id: '123456789', url: 'https://detail.tmall.com/item.htm?id=123456789' });
  assert.equal(productUrl('https://evil.example/item.htm?id=123456789'), null);
  assert.equal(productUrl('https://detail.tmall.com.evil.example/item.htm?id=123456789'), null);
  assert.equal(productUrl('https://detail.tmall.com/item.htm?id=bad'), null);
  assert.equal(productUrl('javascript:alert(1)'), null);
});
test('按标题从嵌套卡片数据提取真实商品ID，不能误取店铺ID或其他商品', () => {
  const data = { shopId: '111111111', data: { item: { itemId: '222222222', title: '儿童运动套装' } } };
  data.loop = data;
  assert.equal(fromProps(data, '儿童运动套装').id, '222222222');
  assert.equal(fromProps(data, '另一件商品'), null);
  assert.equal(fromProps({ shopId: '111111111', title: '儿童运动套装' }, '儿童运动套装'), null);
});
test('CSV 支持中文、逗号、引号、换行，并防止公式注入', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell(' =HYPERLINK("x")'), '"\' =HYPERLINK(""x"")"');
  const out = csv([{ shop: '测试旗舰店', title: '儿童套装', url: 'https://detail.tmall.com/item.htm?id=123456', id: '123456' }]);
  assert.ok(out.startsWith('\uFEFF'));
  assert.ok(out.includes('测试旗舰店'));
  assert.equal(out.split('\r\n').length, 2);
});

const title = '男童运动服套装儿童秋季帅气时髦卫衣卫裤2026新款中大童潮酷秋装';
const titleHtml = `<div class="title--PtjUKgj2" title="${title}" style="font-size:12px;line-height:18px;height:36px;-webkit-line-clamp:2"><img src="https://img.alicdn.com/example.png" class="icon--Upk87qyK" alt="" height="12" width="24"><span>${title}</span></div>`;
test('用户提供的新版标题：跨多层 wrapper 定位外层商品ID，优先完整 title 属性', () => {
  const { document } = parseHTML(`<html><body><a data-item-id="1092926800729" href="https://detail.tmall.com/item.htm?id=999999999"><div class="wrapper--abc"><div class="body--abc"><div class="info--abc">${titleHtml.replace(`<span>${title}</span>`, '<span>被截断的标题…</span>')}<p>¥59.9 0人付款</p></div></div></div></a></body></html>`);
  assert.deepEqual(collect(document).items, [{ title, id: '1092926800729', url: 'https://detail.tmall.com/item.htm?id=1092926800729' }]);
});
test('相邻商品不串链接，嵌套卡片和重复商品去重，缺失链接不伪造', () => {
  const { document } = parseHTML(`<html><body>
    <div data-item-id="123456789"><div class="cardContainer--abc">${titleHtml}</div></div>
    <div data-item-id="222222222">${titleHtml.replaceAll(title, '另一件完整商品标题')}</div>
    <div data-item-id="123456789">${titleHtml}</div>
    <div class="cardContainer--abc">${titleHtml}</div>
    </body></html>`);
  const result = collect(document);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].id, '222222222');
  assert.equal(result.items[1].title, '另一件完整商品标题');
  assert.equal(result.missing, 1);
});
test('旧版商品链接仍可采集，隐藏卡片被排除', () => {
  const { document } = parseHTML(`<html><body><a href="//detail.tmall.com/item.htm?id=123456789" title="旧版儿童运动套装">商品</a><div data-item-id="222222222" hidden>${titleHtml}</div></body></html>`);
  const result = collect(document, el => !el.hasAttribute('hidden'));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '旧版儿童运动套装');
});

test('按设置限制每次新增数量，不再把页面已加载的 120 条全部写入', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1) }));
  const first = limitNewItems(items, () => false, 1);
  assert.equal(first.items.length, 1);
  assert.equal(first.newCount, 1);
  assert.equal(first.reached, true);

  const stored = new Set(['1', '2']);
  const next = limitNewItems(items, item => stored.has(item.id), 3);
  assert.deepEqual(next.items.map(item => item.id), ['1', '2', '3', '4', '5']);
  assert.equal(next.newCount, 3);
});

test('文件名包含店名、品类、北京时间，跨店累计及非法字符得到处理', () => {
  const when = new Date('2026-10-14T18:00:00Z');
  assert.equal(exportName([{shop:'mcticco旗舰店'}], when), 'mcticco旗舰店_全部宝贝_20261015-020000.xlsx');
  assert.equal(exportName([{shop:'店A'},{shop:'店B'}], when), '店A+店B_全部宝贝_20261015-020000.xlsx');
  assert.equal(exportName([{shop:'店/名:*?'}], when), '店_名____全部宝贝_20261015-020000.xlsx');
});

test('Excel 包含新版空列、文本类型、内容适配行列、中文及 XML 转义', () => {
  const bytes = Buffer.from(xlsx([{shop:'测试旗舰店',title:'儿童运动套装'.repeat(20)+'<&',url:'https://detail.tmall.com/item.htm?id=123456789',id:'123456789'}, {shop:'测试旗舰店', title:'=1+1', testResult:'旧结果', titleResult:'有商品', skuResult:'有商品', number:2, url:'链接',id:'222222222'}]));
  const files = {};
  let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) {
    const size = bytes.readUInt32LE(p + 18), length = bytes.readUInt16LE(p + 26), extra = bytes.readUInt16LE(p + 28);
    const name = bytes.subarray(p+30,p+30+length).toString();
    const start = p+30+length+extra;
    files[name] = bytes.subarray(start,start+size).toString(); p=start+size;
  }
  assert.equal(Object.keys(files).length, 6);
  const { DOMParser } = require('linkedom');
  const sheet = new DOMParser().parseFromString(files['xl/worksheets/sheet1.xml'],'text/xml');
  const cell = ref => sheet.querySelector(`c[r="${ref}"]`);
  assert.equal(cell('B1').textContent,'商品标题');
  assert.equal(cell('C1').textContent,'图片');
  assert.equal(cell('H1').textContent,'商品链接');
  assert.equal(cell('C2').textContent,'');
  assert.deepEqual(['E1','F1','G1'].map(ref => cell(ref).textContent), ['标题结果','货号结果','数字']);
  for (const ref of ['E2','F2','G2','E3','F3','G3']) assert.equal(cell(ref).textContent, '');
  assert.equal(sheet.querySelector('dimension').getAttribute('ref'), 'A1:M3');
  assert.equal(sheet.querySelector('autoFilter').getAttribute('ref'), 'A1:M3');
  assert.equal(sheet.querySelectorAll('col').length, 13);
  assert.equal(cell('B3').getAttribute('t'),'inlineStr');
  assert.equal(cell('B3').textContent,'=1+1');
  assert.equal(sheet.querySelectorAll('f').length,0);
  assert.ok(cell('B2').textContent.endsWith('<&'));
  assert.ok(Number(sheet.querySelector('row[r="2"]').getAttribute('ht')) > Number(sheet.querySelector('row[r="3"]').getAttribute('ht')));
  assert.ok(Number(sheet.querySelector('col[min="2"]').getAttribute('width')) > Number(sheet.querySelector('col[min="3"]').getAttribute('width')));
  assert.ok(files['xl/styles.xml'].includes('wrapText="1"'));
});




