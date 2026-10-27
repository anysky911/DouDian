const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSku, firstColor, csv, xlsx } = require('../tmall-new-products.user.js');
const { parseHTML } = require('linkedom');
const fixture = `<div title="颜色分类">参数区</div><div class="skuItemClipX--test"><div><span title="颜色分类">颜色分类</span></div><div><div data-disabled="true"><span class="valueItemText--test" title="19553蓝色+16163黑色【运动套装】">截断标题</span></div><div class="isSelected"><span class="valueItemText--test">19553蓝色【速干长袖】</span></div></div></div>`;
test('首个颜色分类提取组合编码并统一加IN，已有IN不重复', () => {
  for (const [color, sku] of [
    ['19553蓝色+16163黑色【运动套装】','IN19553+16163'],
    ['黑色16163【假两件裤子】','IN16163'],
    ['IN19553蓝色+IN16163黑色','IN19553+16163'],
    ['TH5143+16432','INTH5143+16432'],
    ['【两套换洗组合装】19553蓝色16163黑色+19517灰色16121深蓝色','IN19553+16163+19517+16121'],
    ['00123蓝色','IN00123'], ['ＩＮ５１１１蓝色','IN5111'],
    ['纯蓝色',''], ['120cm 500g 300克',''], ['', ''],
  ]) assert.equal(extractSku(color),sku,color);
});
test('只取第一项，忽略已选中的第二项和参数区；第一项无货号不回退其他项', () => {
  const {document}=parseHTML(fixture);
  assert.equal(firstColor(document),'19553蓝色+16163黑色【运动套装】');
  assert.equal(extractSku(firstColor(document)),'IN19553+16163');
  const {document: noCode}=parseHTML(fixture.replace('19553蓝色+16163黑色【运动套装】','纯蓝色'));
  assert.equal(extractSku(firstColor(noCode)),'');
  assert.equal(firstColor(parseHTML('<span title="颜色分类">颜色分类</span>').document),null);
});
test('Excel和CSV使用详情页货号，三列结果始终留空，不回退标题', () => {
  const row={shop:'测试店',title:'错误标题AB123',sku:'IN19553+16163',id:'834317211932',url:'https://detail.tmall.com/item.htm?id=834317211932',titleResult:'有商品',skuResult:'有商品',number:2};
  assert.ok(csv([row]).includes('"IN19553+16163","","","","https://'));
  assert.ok(csv([{...row,sku:''}]).includes('"错误标题AB123","","","","","","https://'));
  const zip=Buffer.from(xlsx([row])).toString();
  assert.ok(zip.includes('<c r="D2" s="0" t="inlineStr"><is><t xml:space="preserve">IN19553+16163</t>'));
  for (const col of ['E','F','G']) assert.ok(zip.includes(`<c r="${col}2" s="0" t="inlineStr"><is><t xml:space="preserve"></t>`));
});
test('详情页等待异步颜色选项稳定后按商品ID写入货号和任务标记',()=>{
  const vm=require('node:vm'), fs=require('node:fs');
  const {document}=parseHTML(fixture); let tick, now=1000, stopped=false; const saved=new Map();
  const url='https://detail.tmall.com/item.htm?id=834317211932#doudian-sku=test-task';
  const context={document,location:new URL(url),URL,URLSearchParams,Date:{now:()=>now},setInterval:fn=>(tick=fn,1),clearInterval:()=>stopped=true,GM_setValue:(k,v)=>saved.set(k,v)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../tmall-new-products.user.js'),'utf8'),context);
  tick(); assert.equal(saved.size,0); now+=26000; tick();
  const result=saved.get('doudian.sku.first-color.v1.834317211932');
  assert.equal(result.sku,'IN19553+16163'); assert.equal(result.task,'test-task'); assert.equal(result.ok,true); assert.equal(stopped,true);
});
test('详情页未加载或登录拦截时超时写失败状态，不伪造货号',()=>{
  const vm=require('node:vm'),fs=require('node:fs'); let tick,now=1000;const saved=new Map();
  const context={document:parseHTML('<p>请登录</p>').document,location:new URL('https://detail.tmall.com/item.htm?id=834317211932#doudian-sku=test-fail'),URL,URLSearchParams,Date:{now:()=>now},setInterval:fn=>(tick=fn,1),clearInterval:()=>{},GM_getValue:(k,d)=>d,GM_setValue:(k,v)=>saved.set(k,v)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../tmall-new-products.user.js'),'utf8'),context);
  tick();now+=26000;tick();const result=[...saved.values()][0]; assert.equal(result.ok,false);assert.equal(result.sku,'');assert.equal(result.task,'test-fail');
});

test('补采按钮串行打开详情页、接收回填、关闭临时标签并刷新预览', async()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const {document}=parseHTML('<html><head><title>测试店</title></head><body></body></html>');
  const saved=new Map([['doudian.product.v1.amencl.tmall.com.834317211932',{shop:'测试店',title:'运动套装',image:'https://img.alicdn.com/test.jpg',id:'834317211932',url:'https://detail.tmall.com/item.htm?id=834317211932',shopUrl:'https://amencl.tmall.com/',time:'2026-10-20'}]]);
  const opened=[];let closed=0;
  const context={document,location:new URL('https://amencl.tmall.com/'),URL,URLSearchParams,Intl,TextEncoder,Date,window:{addEventListener(){}},setInterval(){},setTimeout:fn=>{fn();},GM_getValue:(k,d)=>saved.has(k)?saved.get(k):d,GM_listValues:()=>[...saved.keys()],GM_setValue:(k,v)=>saved.set(k,v),GM_openInTab:(url,options)=>{opened.push({url,options});saved.set('doudian.sku.first-color.v1.834317211932',{sku:'IN19553+16163',ok:true,imageDone:true,task:new URLSearchParams(new URL(url).hash.slice(1)).get('doudian-sku')});return {close(){closed++;}};}};
  Object.assign(context, require('./image-browser.cjs')(document));
  vm.runInNewContext(fs.readFileSync(require.resolve('../tmall-new-products.user.js'),'utf8'),context);
  const ui=document.getElementById('doudian-collector').shadowRoot;
  await ui.getElementById('sku').onclick();
  assert.equal(opened.length,1);assert.equal(closed,1);assert.equal(opened[0].options.active,false);
  ui.getElementById('preview').onclick();
  assert.ok(ui.getElementById('rows').textContent.includes('IN19553+16163'));
  await ui.getElementById('sku').onclick();assert.equal(opened.length,1);
  assert.equal(ui.getElementById('export').disabled,false);
});

