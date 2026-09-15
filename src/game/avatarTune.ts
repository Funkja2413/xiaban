import { AvatarStudio, DEFAULT_STUDIO_LOOK, type StudioLook } from './avatarStudio';

const STORE = 'avatarStudioLook.v6';

type Field = {
  key: keyof StudioLook;
  label: string;
  min: number;
  max: number;
  step: number;
};

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: '世界氛围（两个角色共用）',
    fields: [
      { key: 'hemi', label: '环境光', min: 0, max: 1.2, step: 0.01 },
      { key: 'keyI', label: '世界主光', min: 0, max: 2, step: 0.01 },
      { key: 'dim', label: '未选中变暗', min: 0.15, max: 1, step: 0.01 },
    ],
  },
  {
    title: '选中顶光（一盏灯，照向点的人）',
    fields: [
      { key: 'spotI', label: '顶光强度', min: 0, max: 90, step: 0.5 },
      { key: 'spotY', label: '灯高度 Y', min: 1.2, max: 6, step: 0.01 },
      { key: 'spotZ', label: '灯头前后 Z', min: -0.4, max: 3, step: 0.01 },
      { key: 'spotAngle', label: '照射张角', min: 0.12, max: 0.7, step: 0.01 },
      { key: 'poolSize', label: '光斑大小', min: 0.25, max: 1.8, step: 0.01 },
      { key: 'poolOpacity', label: '光斑亮度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '地面补光（向上打，提下颌）',
    fields: [
      { key: 'fillI', label: '补光强度', min: 0, max: 16, step: 0.1 },
      { key: 'fillY', label: '灯高度 Y', min: 0.02, max: 0.55, step: 0.01 },
      { key: 'fillZ', label: '灯头前后 Z', min: 0.05, max: 1.4, step: 0.01 },
      { key: 'fillAim', label: '打向高度', min: 0.28, max: 1.15, step: 0.01 },
      { key: 'fillAngle', label: '照射张角', min: 0.18, max: 1.1, step: 0.01 },
    ],
  },
  {
    title: '相机',
    fields: [
      { key: 'figScale', label: '角色缩放', min: 0.4, max: 1.2, step: 0.01 },
      { key: 'fov', label: 'FOV', min: 24, max: 60, step: 0.5 },
      { key: 'camY', label: '相机高度 Y', min: 0.15, max: 2.6, step: 0.01 },
      { key: 'camZ', label: '相机距离 Z', min: 3.2, max: 8, step: 0.01 },
      { key: 'lookY', label: '看向高度', min: 0, max: 1.4, step: 0.01 },
    ],
  },
];

let studio: AvatarStudio | null = null;
let root: HTMLElement | null = null;
let dumpEl: HTMLTextAreaElement | null = null;

function loadLook(): StudioLook {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...DEFAULT_STUDIO_LOOK };
    return { ...DEFAULT_STUDIO_LOOK, ...(JSON.parse(raw) as Partial<StudioLook>) };
  } catch {
    return { ...DEFAULT_STUDIO_LOOK };
  }
}

function saveLook(look: StudioLook) {
  localStorage.setItem(STORE, JSON.stringify(look));
}

function fmt(n: number) {
  return String(Math.round(n * 100) / 100);
}

function syncDump(look: StudioLook) {
  if (dumpEl) dumpEl.value = JSON.stringify(look, null, 2);
}

function apply(partial: Partial<StudioLook>) {
  if (!studio) return;
  const look = { ...studio.look, ...partial };
  studio.applyLook(look);
  saveLook(look);
  syncDump(look);
  root?.querySelectorAll<HTMLInputElement>('[data-key]').forEach((el) => {
    const key = el.dataset.key as keyof StudioLook;
    const v = look[key];
    if (el.type === 'checkbox') el.checked = !!v;
    else {
      el.value = String(v);
      const out = el.parentElement?.querySelector('b');
      if (out) out.textContent = fmt(Number(v));
    }
  });
}

function ensurePanel() {
  if (root && (root.querySelector('[data-key="beamFade"]') || !root.querySelector('[data-key="fillI"]'))) {
    root.remove();
    root = null;
    dumpEl = null;
  }
  if (root) return root;
  const style = document.createElement('style');
  style.textContent = `
    #avatarTune {
      position: fixed; top: 8px; right: 8px; z-index: 4000;
      width: 292px; max-height: calc(100dvh - 16px); overflow: auto;
      background: rgba(12, 12, 18, 0.94); color: #eee;
      border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
      padding: 10px 10px 12px; font: 11px/1.35 -apple-system, "PingFang SC", sans-serif;
      pointer-events: auto; touch-action: pan-y;
      box-shadow: 0 10px 40px rgba(0,0,0,0.45);
    }
    #avatarTune h3 { font-size: 13px; margin: 0 0 8px; letter-spacing: 0.5px; }
    #avatarTune h4 {
      margin: 10px 0 4px; font-size: 10px; color: #ffd257; letter-spacing: 1px;
      text-transform: none;
    }
    #avatarTune .row {
      display: grid; grid-template-columns: 78px 1fr 36px; gap: 6px; align-items: center;
      margin: 3px 0;
    }
    #avatarTune .row span { color: #bbb; }
    #avatarTune .row b { font-weight: 700; text-align: right; color: #fff; font-variant-numeric: tabular-nums; }
    #avatarTune input[type="range"] { width: 100%; margin: 0; }
    #avatarTune .btns { display: flex; gap: 6px; margin: 8px 0 6px; }
    #avatarTune button {
      flex: 1; border: 0; border-radius: 8px; padding: 6px 0; cursor: pointer;
      background: #2a3344; color: #fff; font-size: 11px; font-weight: 700;
    }
    #avatarTune button.gold { background: #c9a227; color: #1a1408; }
    #avatarTune textarea {
      width: 100%; height: 92px; margin-top: 6px; resize: vertical;
      background: #0b0c12; color: #cde; border: 1px solid #333; border-radius: 8px;
      font: 10px/1.35 ui-monospace, Menlo, monospace; padding: 6px;
    }
    #avatarTune label.check { display: flex; gap: 8px; align-items: center; margin: 4px 0 6px; }
    #avatarTune.collapsed { width: auto; max-height: none; overflow: hidden; }
    #avatarTune.collapsed .tuneBody { display: none; }
  `;
  document.head.appendChild(style);

  root = document.createElement('aside');
  root.id = 'avatarTune';
  root.innerHTML = `<h3>选角灯光（临时）</h3>
    <div class="btns">
      <button type="button" id="tuneFold">收起</button>
      <button type="button" id="tuneReset">重置</button>
      <button type="button" class="gold" id="tuneCopy">复制参数</button>
    </div>
    <div class="tuneBody"></div>`;
  document.body.appendChild(root);

  const body = root.querySelector('.tuneBody')!;
  const giz = document.createElement('label');
  giz.className = 'check';
  giz.innerHTML = `<input type="checkbox" data-key="gizmos" /> 显示灯位小球`;
  body.appendChild(giz);

  for (const group of GROUPS) {
    const h = document.createElement('h4');
    h.textContent = group.title;
    body.appendChild(h);
    for (const field of group.fields) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${field.label}</span>
        <input type="range" data-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" />
        <b>0</b>`;
      body.appendChild(row);
    }
  }

  dumpEl = document.createElement('textarea');
  dumpEl.readOnly = true;
  dumpEl.spellcheck = false;
  body.appendChild(dumpEl);

  root.addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement;
    const key = el.dataset.key as keyof StudioLook | undefined;
    if (!key || !studio) return;
    if (el.type === 'checkbox') apply({ [key]: el.checked } as Partial<StudioLook>);
    else apply({ [key]: Number(el.value) } as Partial<StudioLook>);
  });

  root.querySelector('#tuneFold')!.addEventListener('click', () => {
    root!.classList.toggle('collapsed');
    (root!.querySelector('#tuneFold') as HTMLButtonElement).textContent = root!.classList.contains(
      'collapsed'
    )
      ? '展开'
      : '收起';
  });
  root.querySelector('#tuneReset')!.addEventListener('click', () => {
    apply({ ...DEFAULT_STUDIO_LOOK });
  });
  root.querySelector('#tuneCopy')!.addEventListener('click', async () => {
    if (!studio) return;
    const text = JSON.stringify(studio.look, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      (root!.querySelector('#tuneCopy') as HTMLButtonElement).textContent = '已复制';
      setTimeout(() => {
        if (root) (root.querySelector('#tuneCopy') as HTMLButtonElement).textContent = '复制参数';
      }, 1200);
    } catch {
      dumpEl?.select();
    }
    console.log('[avatarStudioLook]', studio.look);
  });

  return root;
}

export function showAvatarTune(target: AvatarStudio) {
  studio = target;
  const look = loadLook();
  target.applyLook(look);
  const el = ensurePanel();
  el.style.display = 'block';
  apply(look);
}

export function hideAvatarTune() {
  if (root) {
    root.remove();
    root = null;
    dumpEl = null;
    studio = null;
  }
  document.getElementById('avatarTune')?.remove();
}
