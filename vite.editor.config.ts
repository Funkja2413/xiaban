import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.join(projectRoot, 'tools/editor');
const colleaguesDir = path.join(projectRoot, 'public/models/colleagues');
const modelsDir = path.join(projectRoot, 'public/models');
const libraryDir = path.join(editorRoot, 'library');

function safeFileName(name: string): string | null {
  const base = path.basename(name);
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  if (!/\.(png|glb|gltf|fbx|json)$/i.test(base)) return null;
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

function colleagueSavePlugin(): Plugin {
  return {
    name: 'colleague-save',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/__editor/')) return next();

        try {
          fs.mkdirSync(path.join(colleaguesDir, 'skins'), { recursive: true });
          fs.mkdirSync(path.join(colleaguesDir, 'props'), { recursive: true });
          fs.mkdirSync(path.join(colleaguesDir, 'thumbs'), { recursive: true });

          const pathname = url.split('?')[0];
          const query = new URL(url, 'http://editor.local').searchParams;

          if (req.method === 'PUT' && pathname === '/__editor/catalog') {
            const body = await readBody(req);
            const parsed = JSON.parse(body.toString('utf8'));
            if (!parsed || typeof parsed !== 'object') throw new Error('invalid catalog');
            fs.writeFileSync(path.join(colleaguesDir, 'catalog.json'), `${JSON.stringify(parsed, null, 2)}\n`);
            json(res, 200, { ok: true, file: '/models/colleagues/catalog.json' });
            return;
          }

          if (req.method === 'POST' && pathname === '/__editor/asset') {
            const dir =
              query.get('dir') === 'skins'
                ? 'skins'
                : query.get('dir') === 'props'
                  ? 'props'
                  : query.get('dir') === 'thumbs'
                    ? 'thumbs'
                    : null;
            const name = safeFileName(query.get('name') ?? '');
            if (!dir || !name) throw new Error('invalid dir or name');
            const body = await readBody(req);
            const dest = path.join(colleaguesDir, dir, name);
            fs.writeFileSync(dest, body);
            json(res, 200, { ok: true, file: `/models/colleagues/${dir}/${name}` });
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
  root: editorRoot,
  publicDir: false,
  cacheDir: path.join(projectRoot, 'node_modules/.vite-editor'),
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  plugins: [serveDir('/models', modelsDir), serveDir('/library', libraryDir), colleagueSavePlugin()],
});
