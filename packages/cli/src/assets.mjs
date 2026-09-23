// Bundled assets for the single-file executables (roles/*.md, protocol.md, templates/*.json).
// In the source tree this stays null and the files are read from disk. scripts/build-binaries.mjs
// rewrites it with the file contents before `bun build --compile` and restores it afterwards.
export const ASSETS = null;
export const VERSION = null;
