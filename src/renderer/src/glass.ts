/**
 * 液态玻璃（Liquid Glass）折射引擎。
 *
 * 做的是**真实折射**而不是普通磨砂：
 *   1. 用 Canvas 生成「圆角矩形 SDF → R/G 通道法线」的位移贴图
 *   2. 把贴图喂给 SVG feDisplacementMap，在玻璃边缘产生折射位移
 *   3. 位移两次（第二次放大 R 通道）→ 色差（类似真实玻璃边缘的彩边）
 *   4. 整个滤镜通过 backdrop-filter: url(#id) blur() saturate() 应用到元素上
 *
 * 设计取舍（都是被性能逼的）：
 *   - 只挑「面积大、数量少、位置稳定」的表面做折射；密集列表一律不做
 *   - 位移贴图按尺寸缓存 —— 大量卡片尺寸相同，只需生成一张
 *   - 元素尺寸没变就跳过重建，所以页面切换的增量开销很小
 *   - 贴图按 0.5 倍分辨率生成：SDF 本身是平滑的，降采样只会更柔，不会走形
 */

const DEFAULT_SCALE = 56; // 折射强度（位移像素）
const CHROMA = 1.12; // R 通道位移倍率，1 = 关闭色差
const BLUR = 9;
const SAT = 165; // %
const BRIGHT = 1.03;
const BAND = 0.34; // 边缘折射带宽（占短边比例）

/**
 * 折射目标。刻意保持精简：
 * 侧栏 / 顶栏 / 右侧信息栏 / 设置页导航 / 弹窗 / 卡片。
 * 文件列表那种几万行的滚动容器**绝不能**加进来，backdrop-filter 会让滚动直接卡死。
 *
 * 判断标准是「它是不是一块独立的表面」：只要在界面上看起来是一块面板，
 * 就应该和别的面板一样是玻璃的 —— 否则会出现"像玻璃了又没完全玻璃"的割裂感
 * （`.settings-nav` 就是漏掉的一个：它原本连背景都没有，在渐变上就是一块裸色）。
 */
const TARGET_SELECTORS = ['.sidebar', '.topbar', '.cart', '.settings-nav', '.modal', '.card'];

const MAX_TARGETS = 18;
const MIN_W = 90;
const MIN_H = 52;
const MAP_RATIO = 0.5;
const MAX_MAP_PIXELS = 160000;
const REBUILD_DEBOUNCE = 90;
/** 距上次重建超过这个间隔就直接立即重建（前缘触发），避免切页时出现"先素颜后上玻璃"的跳变 */
const LEADING_EDGE_MS = 250;

export interface GlassOptions {
  enabled: boolean;
  /** 折射强度（位移像素），0 = 只做磨砂不折射 */
  scale: number;
  /** 背景光斑是否漂移 */
  scene: boolean;
}

interface GlassRuntime {
  svg: SVGSVGElement;
  scene: HTMLDivElement;
  ro: ResizeObserver;
  mo: MutationObserver;
  onResize: () => void;
  onPointer: (e: PointerEvent) => void;
  onOver: (e: PointerEvent) => void;
  /** 重建后按当前指针位置补算一次高光 */
  refreshHighlight: () => void;
  timer: number | null;
  /** 上次重建的时间戳，用于前缘触发判断 */
  lastRebuild: number;
  /** 位移贴图缓存：尺寸 → data URL（大量卡片尺寸相同，只需生成一张） */
  mapCache: Map<string, string>;
  /** 滤镜 def 缓存：key → <filter> 片段（每轮重建都要重新写进 SVG，缓存避免重复生成） */
  defCache: Map<string, string>;
}

let runtime: GlassRuntime | null = null;

const html = (): HTMLElement => document.documentElement;

/* ------------------------------------------------------------------ *
 * 位移贴图
 * ------------------------------------------------------------------ */

/** 生成圆角矩形 SDF 位移贴图（R/G 通道编码法线，B 通道不用） */
function makeMap(w: number, h: number, radius: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(w, h);
  const r = Math.min(radius, w / 2, h / 2);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const band = Math.min(w, h) * BAND;

  const sdf = (x: number, y: number): number => {
    const qx = Math.abs(x - cx) - hw;
    const qy = Math.abs(y - cy) - hh;
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // 只有边缘一条带内才有位移，内部保持 127（不位移）
      const t = smooth(1 - -sdf(x, y) / band);
      let nx = sdf(x + 1, y) - sdf(x - 1, y);
      let ny = sdf(x, y + 1) - sdf(x, y - 1);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const i = (y * w + x) * 4;
      img.data[i] = 127 + nx * t * 127;
      img.data[i + 1] = 127 + ny * t * 127;
      img.data[i + 2] = 127;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function mapFor(w: number, h: number, radius: number, rt: GlassRuntime): string {
  let mw = Math.max(24, Math.round(w * MAP_RATIO));
  let mh = Math.max(24, Math.round(h * MAP_RATIO));
  // 超大元素再压一档，避免生成几 MB 的 data URL
  const pixels = mw * mh;
  if (pixels > MAX_MAP_PIXELS) {
    const k = Math.sqrt(MAX_MAP_PIXELS / pixels);
    mw = Math.max(24, Math.round(mw * k));
    mh = Math.max(24, Math.round(mh * k));
  }
  const key = `${mw}x${mh}x${Math.round(radius)}`;
  const cached = rt.mapCache.get(key);
  if (cached) return cached;

  const map = makeMap(mw, mh, Math.max(2, radius * MAP_RATIO));
  rt.mapCache.set(key, map);
  return map;
}

/* ------------------------------------------------------------------ *
 * 收集与重建
 * ------------------------------------------------------------------ */

function collectTargets(): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  for (const sel of TARGET_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      // 有尺寸、可见、并且不在滚动密集区里
      if (el.offsetWidth < MIN_W || el.offsetHeight < MIN_H) return;
      if (el.closest('.list-pane__body')) return;
      seen.add(el);
    });
  }
  return Array.from(seen).slice(0, MAX_TARGETS);
}

/**
 * 由「尺寸 × 强度 × 是否折射」这个 key 派生稳定的滤镜 id。
 *
 * 同一 key 的滤镜内容完全一样，所以可以让多个元素共用同一个 ——
 * 既省 SVG 体积，也免去维护 per-element id 的麻烦。
 */
function filterId(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `lgf${(h >>> 0).toString(36)}`;
}

function rebuild(): void {
  const rt = runtime;
  if (!rt) return;

  const scale = Number(html().dataset.glassScale ?? DEFAULT_SCALE);
  const defs: string[] = [];
  const keep = new Set<HTMLElement>();

  for (const el of collectTargets()) {
    keep.add(el);
    el.classList.add('lg');

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 14;

    /*
     * 面板内部嵌套的卡片**不做折射**，只做磨砂。
     *
     * 折射模拟的是"一层玻璃压在**有变化的**背景上"。卡片叠在玻璃面板上时，
     * 它背后本来就是一整块均匀的面板 —— 没有可折射的东西；
     * 而 feDisplacementMap 会去采样**位移之后**的位置，卡片一旦靠近面板边缘，
     * 就把面板的边框、甚至面板外的场景颜色一起采进来，
     * 结果是一块发灰/偏色的卡片。实测：「本机数据」那张卡从 #fdfcff 变成 #d8d5f0。
     */
    const nested = el.classList.contains('card') && !!el.parentElement?.closest('.lg');
    const refract = scale > 0 && !nested;

    const key = `${w}x${h}x${Math.round(radius)}x${scale}x${refract ? 'r' : 'p'}`;

    if (refract) {
      /*
       * 注意：**每个折射元素每轮都必须把自己的 filter def 重新写进 SVG**，
       * 因为下面会整体重写 `rt.svg.innerHTML`。
       * 之前这里对"没变化的元素"直接 continue，导致它的 def 不再被收集 ——
       * 切页后旧元素的滤镜从 SVG 里消失，`url(#id)` 指向不存在的节点，
       * 那块 backdrop-filter 就整个失效了。现在改成按 key 缓存 def、每轮都重新挂上。
       */
      let def = rt.defCache.get(key);
      if (!def) {
        const fid = filterId(key);
        const map = mapFor(w, h, radius, rt);
        const s2 = Math.round(scale * CHROMA);
        def =
          `<filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
          `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="dGB"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s2}" xChannelSelector="R" yChannelSelector="G" result="dR"/>` +
          `<feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR"/>` +
          `<feColorMatrix in="dGB" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cGB"/>` +
          `<feBlend in="cR" in2="cGB" mode="screen"/>` +
          `</filter>`;
        rt.defCache.set(key, def);
      }
      defs.push(def);
      const value = `url(#${filterId(key)}) blur(${BLUR}px) saturate(${SAT}%) brightness(${BRIGHT})`;
      el.style.backdropFilter = value;
      el.style.setProperty('-webkit-backdrop-filter', value);
    } else {
      const plain = `blur(${BLUR}px) saturate(${SAT}%) brightness(${BRIGHT})`;
      el.style.backdropFilter = plain;
      el.style.setProperty('-webkit-backdrop-filter', plain);
    }
    el.dataset.lgKey = key;
  }

  // 已经不在页面上的元素：把内联样式清掉，避免它之后复用同一个 DOM 时留着旧滤镜
  document.querySelectorAll<HTMLElement>('.lg').forEach((el) => {
    if (keep.has(el)) return;
    el.classList.remove('lg');
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
    delete el.dataset.lgKey;
  });

  rt.svg.innerHTML = defs.join('');

  // 新拿到 .lg 的元素 inline 变量是空的；如果它正好在光标下，立刻摆正高光
  rt.refreshHighlight();
}

function scheduleRebuild(): void {
  const rt = runtime;
  if (!rt) return;

  const now = performance.now();
  /*
   * 前缘触发：距上次重建已经超过 250ms，说明这是一次"新动作"（切换页面、打开弹窗），
   * 立即重建。否则就要等防抖窗口结束（90ms）才上玻璃，
   * 用户会看到"先素颜、再闪一下变玻璃"。
   * 连续的小变化（拖动窗口、列表滚动）仍然走防抖。
   */
  if (now - rt.lastRebuild > LEADING_EDGE_MS) {
    if (rt.timer !== null) window.clearTimeout(rt.timer);
    rt.timer = null;
    rt.lastRebuild = now;
    rebuild();
    return;
  }

  if (rt.timer !== null) window.clearTimeout(rt.timer);
  rt.timer = window.setTimeout(() => {
    rt.timer = null;
    rt.lastRebuild = performance.now();
    rebuild();
  }, REBUILD_DEBOUNCE);
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

function teardown(): void {
  const rt = runtime;
  if (!rt) return;
  if (rt.timer !== null) window.clearTimeout(rt.timer);
  rt.ro.disconnect();
  rt.mo.disconnect();
  window.removeEventListener('resize', rt.onResize);
  document.removeEventListener('pointermove', rt.onPointer, true);
  document.removeEventListener('pointerover', rt.onOver, true);
  rt.svg.remove();
  rt.scene.remove();
  document.querySelectorAll<HTMLElement>('.lg').forEach((el) => {
    el.classList.remove('lg');
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
    delete el.dataset.lgKey;
  });
  runtime = null;
}

/**
 * 初始化/更新液态玻璃效果。
 *
 * 刻意**不返回清理函数**：React 在依赖变化时会先跑上一次的清理，
 * 如果清理是 teardown，那每次拖动折射强度滑杆都会把整块滤镜拆掉重建（闪一下）。
 * 关闭效果时由本函数自己内部做拆卸，所以这里不需要外部清理。
 */
export function applyGlass(options: GlassOptions): void {
  const root = html();

  if (!options.enabled) {
    root.removeAttribute('data-glass');
    root.removeAttribute('data-glass-scene');
    teardown();
    return;
  }

  root.dataset.glass = 'on';
  root.dataset.glassScale = String(options.scale);
  root.dataset.glassScene = options.scene ? 'on' : 'off';

  // 已经建好 → 只更新参数并重建
  if (runtime) {
    scheduleRebuild();
    return;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;pointer-events:none;opacity:0';
  document.body.appendChild(svg);

  // 背景场景：折射需要身后有可辨认的细节
  const scene = document.createElement('div');
  scene.id = 'glass-scene';
  scene.innerHTML =
    '<div class="lg-orb lg-b1"></div><div class="lg-orb lg-b2"></div>' +
    '<div class="lg-orb lg-b3"></div><div class="lg-orb lg-b4"></div>' +
    '<div class="lg-stripes"></div>';
  document.body.insertBefore(scene, document.body.firstChild);

  const onResize = (): void => scheduleRebuild();

  /** 最近一次指针位置，用于"元素在静止光标下出现"时补算高光 */
  let lastPointerX = -1;
  let lastPointerY = -1;

  /** 把高光中心写到元素上（元素自身坐标系，单位 px） */
  const applyHighlight = (el: HTMLElement, clientX: number, clientY: number): void => {
    const box = el.getBoundingClientRect();
    el.style.setProperty('--lg-mx', `${clientX - box.left}px`);
    el.style.setProperty('--lg-my', `${clientY - box.top}px`);
  };

  const lgUnder = (node: EventTarget | null): HTMLElement | null =>
    ((node as HTMLElement | null)?.closest?.('.lg') as HTMLElement | null) ?? null;

  const onPointer = (e: PointerEvent): void => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    const el = lgUnder(e.target);
    if (el) applyHighlight(el, e.clientX, e.clientY);
  };

  /*
   * 指针"进入"元素时也写一次。
   *
   * 只监听 pointermove 是不够的：**元素可能在光标静止时出现**（切换页面、
   * 玻璃重建、列表刷新），这时 :hover 已经成立、但不会再有任何 pointermove ——
   * 高光就停在 CSS 的默认位置（元素顶部中间），看起来和鼠标位置完全对不上。
   */
  const onOver = (e: PointerEvent): void => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    const el = lgUnder(e.target);
    if (el) applyHighlight(el, e.clientX, e.clientY);
  };

  /**
   * 重建后补算一次。
   * rebuild 会重新分配 .lg，新拿到的元素 inline 变量是空的 ——
   * 如果它此刻正好在光标下面，就得立刻把高光按当前指针位置摆正。
   */
  const refreshHighlightUnderPointer = (): void => {
    if (lastPointerX < 0) return;
    const hit = document.elementFromPoint(lastPointerX, lastPointerY);
    const el = lgUnder(hit);
    if (el) applyHighlight(el, lastPointerX, lastPointerY);
  };

  const rt: GlassRuntime = {
    svg,
    scene,
    ro: new ResizeObserver(() => scheduleRebuild()),
    // 只监听子节点变化（页面切换、列表刷新）；**不监听 attributes**，
    // 否则我们写 backdrop-filter 会触发自己、形成死循环
    mo: new MutationObserver(() => scheduleRebuild()),
    onResize,
    onPointer,
    onOver,
    refreshHighlight: refreshHighlightUnderPointer,
    timer: null,
    lastRebuild: 0,
    mapCache: new Map(),
    defCache: new Map()
  };
  runtime = rt;

  rt.ro.observe(document.body);
  rt.mo.observe(document.getElementById('root') ?? document.body, {
    childList: true,
    subtree: true
  });
  window.addEventListener('resize', onResize);
  document.addEventListener('pointermove', onPointer, true);
  document.addEventListener('pointerover', onOver, true);

  rebuild();
  // 字体/图片加载完布局可能微调，补两次
  window.setTimeout(() => scheduleRebuild(), 400);
  window.setTimeout(() => scheduleRebuild(), 1200);
}
