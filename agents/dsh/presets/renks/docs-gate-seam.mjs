/**
 * The filesystem seam the gate probes through.
 *
 * WHY THIS IS ITS OWN MODULE. The host service separates two calls with an
 * opaque token between them:
 *
 *     stat(target, signal)  <-  resolve(path)  ->  { targetKey, displayPath }
 *
 * `stat` is a method of the SERVICE, and `resolve` returns a target with no
 * methods at all. The gate once called `target.stat()`, so every probe threw a
 * TypeError, every probe then read as "absent", no config doc resolved, and the
 * gate hit its own "no required docs found" branch and opened. It reported
 * healthy and enforced nothing, for as long as it took to notice that no
 * mutation had ever been blocked.
 *
 * That asymmetry is why both calls are folded behind ONE surface here. A caller
 * that cannot reach a non-existent method cannot repeat the mistake, and this is
 * the only module that has to know the shape.
 */

/**
 * Fold a filesystem service, or a `node:fs` stand-in, into one probing surface.
 *
 * @param ctx - the cordis context, read once per plugin registration.
 * @returns `(cwd, signal) => seam`, where the seam is
 *   `{ stat(path), readText(path) }` resolving to `{ type }` or content, and
 *   `undefined` for an absent path.
 */
export function createSeamFor(ctx) {
  const fs = ctx.get('fs')
  if (fs !== undefined) {
    return (cwd, signal) => ({
      stat: async (path) => {
        const target = await fs.resolve(path, { cwd, signal })
        const info = await fs.stat(target, signal)
        return info === undefined ? undefined : { type: info.type }
      },
      // Content, not metadata: the ledger fingerprints what was read, so the
      // gate can tell "this document was read" from "this version was read".
      readText: async (path) => {
        const target = await fs.resolve(path, { cwd, signal })
        return await fs.readText(target, signal)
      },
    })
  }

  return () => ({
    stat: async (path) => {
      const { stat } = await import('node:fs/promises')
      const info = await stat(path)
      return { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other' }
    },
    readText: async (path) => {
      const { readFile } = await import('node:fs/promises')
      return await readFile(path, 'utf8')
    },
  })
}
