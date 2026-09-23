import * as THREE from 'three';
import * as THREE_GPU from 'three/webgpu';

export type BootProgress = {
  /** 开始下一段真实工作。读条只前进，Three 加载器的文件进度填满这一段。 */
  phase(label: string, until: number): void;
  finish(label?: string): void;
  /** 换关再走一遍读条。 */
  reset(label?: string): void;
};

export function bindBootProgress(): BootProgress {
  const bar = document.querySelector('#loadingBar > i') as HTMLElement | null;
  const sub = document.querySelector('#loading .sub') as HTMLElement | null;
  let shown = 0;
  let from = 0;
  let to = 0.04;
  let label = '加载中…';
  let three = { loaded: 0, total: 0 };
  let threeAtPhase = { loaded: 0, total: 0 };

  const paint = (ratio: number, text = label) => {
    shown = Math.max(shown, Math.min(1, ratio));
    if (bar) bar.style.width = `${(shown * 100).toFixed(1)}%`;
    if (sub) sub.textContent = `${text}  ${Math.round(shown * 100)}%`;
  };

  const fillFromThree = () => {
    const addedTotal = Math.max(0, three.total - threeAtPhase.total);
    const addedDone = Math.max(0, three.loaded - threeAtPhase.loaded);
    const inner = addedTotal > 0 ? Math.min(1, addedDone / addedTotal) : 0;
    paint(from + (to - from) * inner);
  };

  const hook = (manager: { onProgress: THREE.LoadingManager['onProgress'] }) => {
    manager.onProgress = (_url, loaded, total) => {
      three = { loaded, total };
      fillFromThree();
    };
  };
  hook(THREE.DefaultLoadingManager);
  hook(THREE_GPU.DefaultLoadingManager);

  paint(0.01, '加载中…');

  return {
    phase(nextLabel, until) {
      shown = Math.max(shown, to);
      from = shown;
      to = Math.max(until, from + 0.02);
      threeAtPhase = { ...three };
      label = nextLabel;
      paint(from, nextLabel);
    },
    finish(nextLabel = '即将进入') {
      label = nextLabel;
      paint(1, nextLabel);
    },
    reset(nextLabel = '正在进入办公室…') {
      shown = 0;
      from = 0;
      to = 0.04;
      label = nextLabel;
      three = { loaded: 0, total: 0 };
      threeAtPhase = { loaded: 0, total: 0 };
      paint(0.01, nextLabel);
    },
  };
}
