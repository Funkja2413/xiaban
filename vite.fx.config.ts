import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.join(projectRoot, 'tools/fx-editor');
const fxDir = path.join(projectRoot, 'public/fx');
const modelsDir = path.join(projectRoot, 'public/models');
const levelsDir = path.join(projectRoot, 'public/levels');

function readBody(req: import('node:http').IncomingMessage, limit = 2 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('file too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: import('node:http').ServerResponse, code: number, data: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function fxSavePlugin(): Plugin {
  return {
    name: 'fx-save',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/__fx/')) return next();
        try {
          fs.mkdirSync(fxDir, { recursive: true });
          const pathname = url.split('?')[0];
          if (req.method === 'PUT' && pathname === '/__fx/catalog') {
            const body = await readBody(req);
            const parsed = JSON.parse(body.toString('utf8'));
            if (!parsed || typeof parsed !== 'object') throw new Error('invalid catalog');
            fs.writeFileSync(path.join(fxDir, 'catalog.json'), `${JSON.stringify(parsed, null, 2)}\n`);
            json(res, 200, { ok: true, file: '/fx/catalog.json' });
            return;
          }
          json(res, 404, { error: 'not found' });
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

function mimeFor(file: string) {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.fbx': 'application/octet-stream',
    '.json': 'application/json',
  };
  return types[ext] ?? 'application/octet-stream';
}

function serveDir(mount: string, dir: string): Plugin {
  return {
    name: `serve-${mount}`,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !url.startsWith(`${mount}/`)) return next();
        const rel = decodeURIComponent(url.slice(mount.length).split('?')[0]);
        const file = path.normalize(path.join(dir, rel));
        const rootNorm = path.normalize(dir + path.sep);
        if (!file.startsWith(rootNorm) && file !== path.normalize(dir)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', mimeFor(file));
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

function rosterWatchPlugin(): Plugin {
  const catalogFile = path.join(modelsDir, 'colleagues', 'catalog.json');
  const skinsDir = path.join(modelsDir, 'colleagues', 'skins');
  const ping = (file: string) => {
    const n = path.normalize(file);
    return n === path.normalize(catalogFile) || n.startsWith(path.normalize(skinsDir + path.sep));
  };
  return {
    name: 'roster-watch',
    configureServer(server) {
      server.watcher.add(catalogFile);
      server.watcher.add(skinsDir);
      const send = () => server.ws.send({ type: 'custom', event: 'roster-catalog' });
      server.watcher.on('change', (file) => {
        if (ping(file)) send();
      });
    },
    handleHotUpdate(ctx) {
      if (!ping(ctx.file)) return;
      ctx.server.ws.send({ type: 'custom', event: 'roster-catalog' });
      return [];
    },
  };
}

function serveFx(): Plugin {
  return {
    name: 'serve-fx',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !url.startsWith('/fx/')) return next();
        const rel = decodeURIComponent(url.slice(4).split('?')[0]);
        const file = path.normalize(path.join(fxDir, rel));
        const rootNorm = path.normalize(fxDir + path.sep);
        if (!file.startsWith(rootNorm) && file !== path.normalize(fxDir)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', 'application/json');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: editorRoot,
  publicDir: false,
  cacheDir: path.join(projectRoot, 'node_modules/.vite-fx'),
  optimizeDeps: {
    include: [
      'three/webgpu',
      'three/addons/controls/OrbitControls.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/FBXLoader.js',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/utils/BufferGeometryUtils.js',
      '@dimforge/rapier3d-compat',
    ],
  },
  server: {
    host: true,
    port: 5176,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  plugins: [serveDir('/models', modelsDir), serveDir('/levels', levelsDir), serveFx(), fxSavePlugin(), rosterWatchPlugin()],
});
