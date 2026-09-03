/** 游戏画布锁在 9:16 竖屏舞台里，桌面左右留黑边，真机铺满。不要用 window 尺寸。 */

export function getStage(): HTMLElement {
  const el = document.getElementById('stage');
  if (!el) throw new Error('#stage missing');
  return el;
}

export function getStageSize() {
  const el = getStage();
  return { w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) };
}

export function stageRect() {
  return getStage().getBoundingClientRect();
}

export function onStageResize(fn: (s: { w: number; h: number }) => void) {
  const el = getStage();
  const fire = () => fn(getStageSize());
  new ResizeObserver(fire).observe(el);
  window.addEventListener('orientationchange', fire);
}

export function clientToStageNdc(clientX: number, clientY: number) {
  const r = stageRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  return {
    x: ((clientX - r.left) / w) * 2 - 1,
    y: -((clientY - r.top) / h) * 2 + 1,
  };
}

export function clientToStage(clientX: number, clientY: number) {
  const r = stageRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

export function isStageLeft(clientX: number) {
  const r = stageRect();
  return clientX < r.left + r.width * 0.5;
}
