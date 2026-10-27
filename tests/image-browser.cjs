// Minimal browser image transport for exercising the actual download/decode path.
module.exports = function imageBrowser(document, sizes = () => [240, 240]) {
  const blobs = new Map(); let next = 0;
  class TestURL extends URL {
    static createObjectURL(blob) { const key = `blob:test-${next++}`; blobs.set(key, blob); return key; }
    static revokeObjectURL(key) { blobs.delete(key); }
  }
  class TestImage {
    set src(key) {
      [this.naturalWidth, this.naturalHeight] = sizes(blobs.get(key)?.source);
      queueMicrotask(() => this.onload());
    }
  }
  const original = document.createElement.bind(document);
  document.createElement = tag => {
    if (tag !== 'canvas') return original(tag);
    return { getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob: callback => callback(new Blob([Uint8Array.of(255, 216, 255, 217)])) };
  };
  return {
    URL: TestURL, Image: TestImage, Blob, clearTimeout() {},
    setTimeout(fn, ms) { if (ms <= 1500) queueMicrotask(fn); return 1; },
    GM_xmlhttpRequest(options) {
      const blob = new Blob(['image']); blob.source = options.url;
      queueMicrotask(() => options.onload({ status: 200, response: blob }));
      return { abort() {} };
    }
  };
};
