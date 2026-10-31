import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
for (const project of ['tsconfig.json', 'tsconfig.cjs.json']) {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project], {
    cwd: root,
    stdio: 'inherit',
  });
}
mkdirSync(new URL('../dist/cjs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{"type":"commonjs"}\n');
