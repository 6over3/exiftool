const shared = {
  entrypoints: ['src/index.ts'],
  sourcemap: 'inline' as const,
  minify: true,
  external: ['@6over3/zeroperl-ts']
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
    outdir: 'public',
    format: 'esm',
    target: 'browser',
    minify: true,
    entrypoints: ['index.html'],
    external: ['node:*'],
    naming: {
      chunk: '[name].js',
      asset: '[name].[ext]',
    },
  }),
]);

export {};