import AdmZip from 'adm-zip';
import { statSync } from 'node:fs';

export function zipDirToBuffer(dirPath) {
  const st = statSync(dirPath);
  if (!st.isDirectory()) throw new Error('not_a_directory');
  const z = new AdmZip();
  z.addLocalFolder(dirPath);
  return z.toBuffer();
}

export function createZipWithFiles(files) {
  const z = new AdmZip();
  for (const f of files) {
    if (f.fromDisk) z.addLocalFile(f.fromDisk, f.zipPath || '');
    else z.addFile(f.name, Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data)));
  }
  return z;
}
