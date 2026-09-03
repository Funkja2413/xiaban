import { defineConfig, type Plugin } from 'vite';
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
            levels?: { atmosphere?: { floor?: { map?: string | null }; wall?: { map?: string | null } } }[];
          };
          const toAbs = (p: string) => path.normalize(path.join(dist, p.replace(/^\//, '')));
          for (const lv of cat.levels ?? []) {
            if (lv.atmosphere?.floor?.map) keepLevels.add(toAbs(lv.atmosphere.floor.map));
            if (lv.atmosphere?.wall?.map) keepLevels.add(toAbs(lv.atmosphere.wall.map));
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
  plugins: [editorRedirectPlugin(), fxLivePlugin(), catalogPrunePlugin()],
  build: {
    rollupOptions: {
      input: path.join(root, 'index.html'),
    },
  },
}));
