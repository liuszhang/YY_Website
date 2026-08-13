// 响应式缩放：把固定 780px 宽的「纸页」按视口宽度等比缩放，
// 让这份宣传册在手机 / 窄屏上也能完整查看（不再横向溢出或被裁切）。
(function () {
  function fit() {
    var pages = document.querySelectorAll('.page');
    if (!pages.length) return;
    var body = document.body;
    var wrap = document.getElementById('brochure');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'brochure';
      body.insertBefore(wrap, pages[0]);
      for (var i = 0; i < pages.length; i++) {
        wrap.appendChild(pages[i]);
      }
    }
    // 预留左右各 12px 边距
    var avail = document.documentElement.clientWidth - 24;
    var scale = Math.min(1, avail / 780);
    wrap.style.zoom = scale;
  }

  if (document.readyState !== 'loading') {
    fit();
  } else {
    document.addEventListener('DOMContentLoaded', fit);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);

  // P2-7 开发期溢出巡检：地址后加 ?audit 打开，
  // 任何内容超出 1060px 固定页高的页面会被标红，避免“静默丢内容”。
  window.addEventListener('load', function () {
    if (location.search.indexOf('audit') === -1) return;
    var ps = document.querySelectorAll('.page');
    var bad = [];
    Array.prototype.forEach.call(ps, function (p, i) {
      if (p.scrollHeight > p.clientHeight + 2) {
        p.style.outline = '3px solid #ff3b30';
        p.style.outlineOffset = '-3px';
        bad.push('第 ' + (i + 1) + ' 页：内容高度 ' + p.scrollHeight + 'px > 页高 ' + p.clientHeight + 'px');
      }
    });
    if (bad.length) {
      console.warn('[溢出巡检] 发现 ' + bad.length + ' 个页面内容被裁切：\n' + bad.join('\n'));
    } else {
      console.log('[溢出巡检] 未发现内容溢出，所有页面均在 1060px 内。');
    }
  });
})();
