// 按需加载 PDF 依赖（html2canvas / jsPDF），
// 首屏不再为「下载 PDF」预先加载数百 KB。
function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('脚本加载失败: ' + src)); };
    document.head.appendChild(s);
  });
}

function ensureLibs() {
  var queue = [];
  if (typeof window.html2canvas === 'undefined') {
    // 本地同域自托管，避免被浏览器「跟踪防护」把第三方 CDN 当 tracker 拦截
    queue.push('js/vendor/html2canvas.min.js');
  }
  if (typeof window.jspdf === 'undefined') {
    queue.push('js/vendor/jspdf.umd.min.js');
  }
  if (!queue.length) return Promise.resolve();
  return queue.reduce(function (p, src) {
    return p.then(function () { return loadScript(src); });
  }, Promise.resolve());
}

function showToast(msg, done) {
  var toast = document.getElementById('pdfToast');
  var spinner = document.getElementById('toastSpinner');
  var icon = document.getElementById('toastIcon');
  var text = document.getElementById('toastMsg');
  text.textContent = msg;
  if (done) {
    spinner.style.display = 'none';
    icon.style.display = '';
    // 用 SVG 对勾替代 emoji，跨平台渲染一致
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>';
  } else {
    spinner.style.display = '';
    icon.style.display = 'none';
  }
  toast.classList.add('show');
}
function hideToast() {
  document.getElementById('pdfToast').classList.remove('show');
}

function downloadPDF() {
  var btn = document.querySelector('.fab-pdf');
  if (btn) btn.style.display = 'none';
  showToast('正在准备导出组件...');
  ensureLibs().then(function () {
    generatePDF(btn);
  }).catch(function () {
    hideToast();
    if (btn) btn.style.display = '';
    alert('PDF 组件加载失败，请检查网络后重试。');
  });
}

// 取渐变字符串里的第一个颜色，作为渐变文字的纯色兜底
function firstColorOf(grad) {
  var m = (grad || '').match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : null;
}

// html2canvas 1.4.1 的已知缺陷：渲染某些渐变/图案/内联 SVG 背景时，
// 会用一个 width/height 为 0 的离屏 canvas 去调 createPattern 而崩溃，
// 导致整本导出中断。这里给 CanvasRenderingContext2D.createPattern 加护栏：
// 凡传入 0 尺寸画布/图片，一律替换为 1x1 透明画布，让渲染继续而不打断导出；
// 正常尺寸的模式原样透传，不影响画面。仅作用于导出过程。
function patchCreatePattern() {
  if (window.__h2cPatternPatched) return;
  var Ctx = window.CanvasRenderingContext2D ||
    (typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D : null);
  if (!Ctx || !Ctx.prototype || typeof Ctx.prototype.createPattern !== 'function') return;
  var orig = Ctx.prototype.createPattern;
  Ctx.prototype.createPattern = function (image, repetition) {
    var bad = image && (
      image.width === 0 || image.height === 0 ||
      (typeof image.naturalWidth === 'number' && (image.naturalWidth === 0 || image.naturalHeight === 0))
    );
    if (bad) {
      var c = document.createElement('canvas'); c.width = 1; c.height = 1;
      try { return orig.call(this, c, repetition); } catch (e) { return null; }
    }
    try { return orig.call(this, image, repetition); }
    catch (e) {
      var c2 = document.createElement('canvas'); c2.width = 1; c2.height = 1;
      try { return orig.call(this, c2, repetition); } catch (_) { return null; }
    }
  };
  window.__h2cPatternPatched = true;
}

// html2canvas 不支持 mask-image + 渐变背景，克隆里直接隐藏带 mask 的装饰元素
// （如封面网点），并兜底 0 尺寸却带渐变背景的元素（0 尺寸本就画不出东西）。
// 仅作用于克隆文档，不影响线上实际页面。
function neutralizeCloneForExport(doc) {
  var masked = doc.querySelectorAll('.dc-bg-pattern');
  Array.prototype.forEach.call(masked, function (el) { el.style.display = 'none'; });

  var all = doc.querySelectorAll('*');
  Array.prototype.forEach.call(all, function (el) {
    var bg = (getComputedStyle(el).backgroundImage) || '';
    if (bg.indexOf('gradient') === -1) return;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) {
      el.style.backgroundImage = 'none';
    }
  });
}

function generatePDF(btn) {
  // 还原响应式缩放，保证 1:1 像素导出
  var wrap = document.getElementById('brochure');
  var prevZoom = wrap ? wrap.style.zoom : '';
  if (wrap) wrap.style.zoom = 1;
  patchCreatePattern(); // 护栏：拦截 html2canvas 的 0x0 createPattern 崩溃

  showToast('正在生成 PDF...');

  var pages = document.querySelectorAll('.page');
  var total = pages.length;
  var PAGE_W = 780;
  var PAGE_H = 1060;
  var pdf = new jspdf.jsPDF({ unit: 'px', format: [PAGE_W, PAGE_H], orientation: 'portrait' });

  // Temporarily ensure all pages render at full width
  var savedOverflow = [];
  pages.forEach(function (page) {
    savedOverflow.push(page.style.overflow);
    page.style.overflow = 'visible';
  });

  // 自动兜底所有渐变文字：html2canvas 不支持 background-clip:text，
  // 逐元素探测并把 clip 文字临时转成纯色（取自身渐变的首色），导出后还原。
  // 判定「渐变裁切文字」：有渐变背景 + (clip 为 text 或 文字透明)。
  // 关键坑：getComputedStyle 会把 transparent 归一化成 "rgba(0, 0, 0, 0)"，
  // 不能再用 === 'transparent' 严格比较，否则兜底探测会漏掉元素（如封面 .cyan），
  // 导致渐变字原样交给 html2canvas → 导出后文字丢失颜色。
  function isGradientText(cs) {
    var bg = (cs.backgroundImage || '').toLowerCase();
    if (bg.indexOf('gradient') === -1) return false;
    var fill = (cs.webkitTextFillColor || '').toLowerCase();
    var transparent = fill === 'transparent' ||
      /rgba?\(\s*0[\s,]*,?\s*0[\s,]*,?\s*0[\s,]*,?\s*0\s*\)/.test(fill);
    var clip = ((cs.webkitBackgroundClip || '') + ' ' + (cs.backgroundClip || '')).toLowerCase();
    var clipText = clip.indexOf('text') !== -1;
    return clipText || transparent;
  }

  var gradEls = [];
  var allEls = document.querySelectorAll('.page *');
  Array.prototype.forEach.call(allEls, function (el) {
    var cs = getComputedStyle(el);
    if (!isGradientText(cs)) return;
    var solid = firstColorOf(cs.backgroundImage) || '#0066CC';
    gradEls.push({
      el: el,
      bg: el.style.backgroundImage,
      clip: el.style.webkitBackgroundClip,
      fill: el.style.webkitTextFillColor,
      color: el.style.color
    });
    // 关键：html2canvas 渲染文字只读 color、不读 -webkit-text-fill-color，
    // 所以必须把 color 也改成纯色，否则仍会沿用继承自封面的白色。
    el.style.backgroundImage = 'none';
    el.style.webkitBackgroundClip = 'border-box';
    el.style.backgroundClip = 'border-box';
    el.style.webkitTextFillColor = solid;
    el.style.color = solid;
  });

  var tasks = [];
  pages.forEach(function (page, i) {
    tasks.push(function () {
      showToast('正在渲染第 ' + (i + 1) + ' / ' + total + ' 页...');
      return html2canvas(page, {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        backgroundColor: null,
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: Math.max(PAGE_W, document.documentElement.scrollWidth),
        windowHeight: Math.max(PAGE_H, document.documentElement.scrollHeight),
        scrollX: 0,
        scrollY: 0,
        onclone: function (clonedDoc) {
          neutralizeCloneForExport(clonedDoc);
        }
      }).then(function (canvas) {
        var imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PAGE_H);
      });
    });
  });

  tasks.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
    .then(function () {
      // 还原渐变文字
      gradEls.forEach(function (rec) {
        rec.el.style.backgroundImage = rec.bg;
        rec.el.style.webkitBackgroundClip = rec.clip;
        rec.el.style.backgroundClip = rec.clip;
        rec.el.style.webkitTextFillColor = rec.fill;
        rec.el.style.color = rec.color;
      });
      // 还原页面溢出与缩放
      pages.forEach(function (page, i) {
        page.style.overflow = savedOverflow[i] || '';
      });
      if (wrap) wrap.style.zoom = prevZoom || '';
      showToast('PDF 生成完成，正在下载...', true);
      pdf.save('寸金平台-产品手册.pdf');
      setTimeout(function () {
        hideToast();
        if (btn) btn.style.display = '';
      }, 2000);
    });
}
