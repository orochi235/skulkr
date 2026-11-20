/**
 * Exits with `code` once stdout has drained. `process.exit` right after a write to a pipe drops whatever the pipe has
 * not taken yet, and a dashboard reading `skulkr map` through one got its JSON cut at 65,536 bytes.
 */
export const exitAfterFlush = (code) => {
  process.stdout.write('', () => process.exit(code));
};
