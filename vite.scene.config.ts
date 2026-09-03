import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.join(projectRoot, 'tools/scene-editor');
const levelsDir = path.join(projectRoot, 'public/levels');
const modelsDir = path.join(projectRoot, 'public/models');

function safeFileName(name: string): string | null {
  const base = path.basename(name);
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  if (!/\.(png|jpg|jpeg|webp)$/i.test(base)) return null;
  return base;
}

function readBody(req: import('node:http').IncomingMessage, limit = 16 * 1024 * 1024): Promise<Buffer> {
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

function mimeFor(file: string) {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
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

function sceneSavePlugin(): Plugin {
  return {
    name: 'scene-save',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/__scene/')) return next();

        try {
          fs.mkdirSync(path.join(levelsDir, 'textures'), { recursive: true });
          const pathname = url.split('?')[0];
          const query = new URL(url, 'http://scene.local').searchParams;

          if (req.method === 'PUT' && pathname === '/__scene/catalog') {
            const body = await readBody(req);
            const parsed = JSON.parse(body.toString('utf8'));
            if (!parsed || typeof parsed !== 'object') throw new Error('invalid catalog');
            fs.writeFileSync(path.join(levelsDir, 'catalog.json'), `${JSON.stringify(parsed, null, 2)}\n`);
            json(res, 200, { ok: true, file: '/levels/catalog.json' });
            return;
          }

          if (req.method === 'POST' && pathname === '/__scene/texture') {
            const name = safeFileName(query.get('name') ?? '');
            if (!name) throw new Error('invalid name');
            const body = await readBody(req);
            const dest = path.join(levelsDir, 'textures', name);
            fs.writeFileSync(dest, body);
            json(res, 200, { ok: true, file: `/levels/textures/${name}` });
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

export default defineConfig({
  cacheDir: path.join(projectRoot, 'node_modules/.vite-scene'),
  root: editorRoot,
  publicDir: false,
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  plugins: [serveDir('/levels', levelsDir), serveDir('/models', modelsDir), sceneSavePlugin()],
});
