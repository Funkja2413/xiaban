import { defineConfig, type Plugin } from 'vite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function collectGltfDeps(abs: string, keep: Set<string>) {
  keep.add(path.normalize(abs));
  if (!abs.endsWith('.gltf') || !fs.existsSync(abs)) return;
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
      images?: { uri?: string }[];
      buffers?: { uri?: string }[];
    };
    const dir = path.dirname(abs);
    for (const img of json.images ?? []) {
      if (img.uri && !img.uri.startsWith('data:')) keep.add(path.normalize(path.join(dir, img.uri)));
    }
    for (const buf of json.buffers ?? []) {
      if (buf.uri && !buf.uri.startsWith('data:')) keep.add(path.normalize(path.join(dir, buf.uri)));
    }
  } catch {
    /* ignore unreadable gltf */
  }
}

/** 发布包只留 catalog 引用过的同事素材；Kenney 底模始终带上。编辑器不进 dist。 */
function catalogPrunePlugin(): Plugin {
  return {
    name: 'catalog-prune',
    apply: 'build',
    closeBundle() {
      const dist = path.join(root, 'dist');
      const colleagues = path.join(dist, 'models/colleagues');
      const catalogFile = path.join(colleagues, 'catalog.json');
      const keep = new Set<string>();
      if (fs.existsSync(catalogFile)) {
        keep.add(path.normalize(catalogFile));
        const cat = JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as {
          skins?: { file?: string }[];
          props?: { file?: string }[];
          hairs?: { file?: string }[];
          days?: {
            variants?: {
              thumb?: string | null;
              kitHairMap?: string | null;
              kitSkirtMap?: string | null;
            }[];
          }[];
        };
        const toAbs = (p: string) => path.normalize(path.join(dist, p.replace(/^\//, '')));
        for (const s of cat.skins ?? []) if (s.file) collectGltfDeps(toAbs(s.file), keep);
        for (const p of cat.props ?? []) if (p.file) collectGltfDeps(toAbs(p.file), keep);
        for (const h of cat.hairs ?? []) if (h.file) collectGltfDeps(toAbs(h.file), keep);
        for (const day of cat.days ?? []) {
          for (const v of day.variants ?? []) {
            if (v.thumb) keep.add(toAbs(v.thumb));
            if (v.kitHairMap) keep.add(toAbs(v.kitHairMap));
            if (v.kitSkirtMap) keep.add(toAbs(v.kitSkirtMap));
          }
        }
      }
      if (fs.existsSync(colleagues)) {
        const walk = (dir: string) => {
          for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('.')) {
              fs.rmSync(path.join(dir, name), { recursive: true, force: true });
              continue;
            }
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
              walk(full);
              if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
            } else if (!keep.has(path.normalize(full))) {
              fs.unlinkSync(full);
            }
          }
        };
        walk(colleagues);
      }
      const strayEditor = path.join(dist, 'editor.html');
      if (fs.existsSync(strayEditor)) fs.unlinkSync(strayEditor);

      const levels = path.join(dist, 'levels');
      const levelCatalog = path.join(levels, 'catalog.json');
      const keepLevels = new Set<string>();
      if (fs.existsSync(levelCatalog)) {
        keepLevels.add(path.normalize(levelCatalog));
        try {
          const cat = JSON.parse(fs.readFileSync(levelCatalog, 'utf8')) as {
            levels?: {
              atmosphere?: { floor?: { map?: string | null }; wall?: { map?: string | null } };
              walls?: { faces?: Record<string, { map?: string | null } | string> }[];
              boundFaces?: Record<string, Record<string, { map?: string | null } | string>>;
            }[];
          };
          const toAbs = (p: string) => path.normalize(path.join(dist, p.replace(/^\//, '')));
          const keepFace = (faces?: Record<string, { map?: string | null } | string>) => {
            if (!faces) return;
            for (const v of Object.values(faces)) {
              if (v && typeof v === 'object' && v.map) keepLevels.add(toAbs(v.map));
            }
          };
          for (const lv of cat.levels ?? []) {
            if (lv.atmosphere?.floor?.map) keepLevels.add(toAbs(lv.atmosphere.floor.map));
            if (lv.atmosphere?.wall?.map) keepLevels.add(toAbs(lv.atmosphere.wall.map));
            for (const w of lv.walls ?? []) keepFace(w.faces);
            if (lv.boundFaces) for (const faces of Object.values(lv.boundFaces)) keepFace(faces);
          }
        } catch {
          /* keep catalog only */
        }
      }
      if (fs.existsSync(levels)) {
        const walkLevels = (dir: string) => {
          for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('.')) {
              fs.rmSync(path.join(dir, name), { recursive: true, force: true });
              continue;
            }
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
              walkLevels(full);
              if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
            } else if (!keepLevels.has(path.normalize(full))) {
              fs.unlinkSync(full);
            }
          }
        };
        walkLevels(levels);
      }
    },
  };
}

/** 发布包里的关卡墙贴缩到长边 1024。源图不动，场景编辑器仍用原分辨率。 */
function shrinkLevelTexturesPlugin(): Plugin {
  return {
    name: 'shrink-level-textures',
    apply: 'build',
    closeBundle() {
      const dir = path.join(root, 'dist/levels');
      if (!fs.existsSync(dir)) return;
      const script = `
import os, sys
from PIL import Image
root, max_edge = sys.argv[1], 1024
n = saved = 0
for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.lower().endswith('.png'):
            continue
        p = os.path.join(dirpath, name)
        before = os.path.getsize(p)
        im = Image.open(p)
        w, h = im.size
        if max(w, h) <= max_edge:
            continue
        scale = max_edge / max(w, h)
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
        im.save(p, optimize=True, compress_level=9)
        n += 1
        saved += before - os.path.getsize(p)
print(f'shrink-level-textures {n} files, saved {saved/1e6:.1f} MB')
`;
      const run = spawnSync('python3', ['-c', script, dir], { encoding: 'utf8' });
      if (run.status !== 0) {
        console.warn('[shrink-level-textures] skipped:', (run.stderr || run.stdout || '').trim());
        return;
      }
      const line = (run.stdout || '').trim().split('\n').pop();
      if (line) console.log(line);
    },
  };
}

function editorRedirectPlugin(): Plugin {
  return {
    name: 'editor-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/editor' || url === '/editor.html') {
          res.statusCode = 302;
          res.setHeader('Location', 'http://localhost:5174/');
          res.end();
          return;
        }
        if (url === '/scene' || url === '/scene.html') {
          res.statusCode = 302;
          res.setHeader('Location', 'http://localhost:5175/');
          res.end();
          return;
        }
        next();
      });
    },
  };
}

/** 特效编辑器把 catalog 推进正在跑的游戏，不整页刷新 */
function fxLivePlugin(): Plugin {
  return {
    name: 'fx-live',
    apply: 'serve',
    configureServer(server) {
      const file = path.join(root, 'public/fx/catalog.json');
      server.watcher.unwatch(file);
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/__fx/push') return next();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'PUT') return next();
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
            if (!parsed || typeof parsed !== 'object') throw new Error('invalid catalog');
            server.ws.send({ type: 'custom', event: 'fx-catalog', data: parsed });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        });
      });
    },
  };
}

function publicBase(command: string) {
  if (command !== 'build') return '/';
  const raw = process.env.BASE_PATH?.trim();
  if (!raw) return './';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export default defineConfig(({ command }) => ({
  base: publicBase(command),
  appType: 'mpa',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/public/fx/catalog.json'],
    },
  },
  plugins: [editorRedirectPlugin(), fxLivePlugin(), catalogPrunePlugin(), shrinkLevelTexturesPlugin()],
  build: {
    rollupOptions: {
      input: path.join(root, 'index.html'),
    },
  },
}));
