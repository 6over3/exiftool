const shared = {
  entrypoints: ['src/index.ts'],
  sourcemap: 'linked' as const,
  minify: true,
};

await Promise.all([
  Bun.build({
    ...shared,
    outdir: 'dist/esm',
    format: 'esm',
    target: 'browser',
    naming: '[name].js',
  }),
  
  // CommonJS build for Node
  Bun.build({
    ...shared,
    outdir: 'dist/cjs',
    format: 'cjs',
    target: 'node',
    naming: '[name].cjs',
  }),
  
  // Browser-only demo build
  Bun.build({
    ...shared,
    outdir: 'demo',
    format: 'esm',
    target: 'browser',
    minify: true,
    external: ['node:*'],
    naming: {
      entry: 'index.esm.js',
      chunk: '[name]-[hash].js',
      asset: '[name]-[hash].[ext]',
    },
  }),
]);

export {};