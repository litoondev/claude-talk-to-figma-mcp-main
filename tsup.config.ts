import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/talk_to_figma_mcp/server.ts', 'src/socket.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  target: 'node18',
  sourcemap: true,
  minify: false,
  splitting: false,
  bundle: true,
  /**
   * Bundle the runtime dependencies into the output instead of leaving them as
   * `require()` calls resolved from node_modules.
   *
   * tsup externalises anything in `dependencies` by default, which meant the
   * shipped extension had to carry node_modules so that four packages
   * (@modelcontextprotocol/sdk, ws, uuid, zod) could be resolved at startup.
   * Packing then walked 115MB and ~5,965 files to deliver ~1MB of code: 99.7%
   * of the archive was dependencies, nearly all of them dev-only ones that were
   * never needed at runtime at all.
   *
   * With them inlined, `node_modules/` leaves the package entirely (see
   * .dxtignore) and the extension is just the bundle plus the plugin and icon.
   */
  noExternal: ['@modelcontextprotocol/sdk', 'ws', 'uuid', 'zod'],
});
