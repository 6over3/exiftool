import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { raw } from 'esbuild-raw-plugin';
import { es5Plugin } from 'esbuild-plugin-es5';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  sourcemap: true,
  minify: true,
  plugins: [raw()],
  target: ['ESNext'],
  tsconfig: 'tsconfig.esm.json',
};

const prodESM = build({
  ...shared,
  outfile: 'dist/esm/index.js',
});

const prodCJS = build({
  ...shared,
  plugins: [...shared.plugins, es5Plugin()],
  target: ['es5'],
  alias: {
    '@swc/helpers': path.dirname(
      fileURLToPath(import.meta.resolve('@swc/helpers/package.json'))
    ),
  },
  outfile: 'dist/cjs/index.cjs',
  tsconfig: 'tsconfig.cjs.json',
});

const demo = build({
  ...shared,
  outfile: 'demo/index.esm.js',
  minify: false,
});

Promise.all([prodESM, prodCJS, demo]).catch(() => process.exit(1));
