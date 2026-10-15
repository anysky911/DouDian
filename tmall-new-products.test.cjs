const test = require('node:test');
const assert = require('node:assert/strict');
const { productUrl, fromProps, csv, csvCell, collect } = require('./tmall-new-products.user.js');
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
