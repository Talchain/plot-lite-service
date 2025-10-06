import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', reject);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
