/**
 * Exits with `code` once stdout has drained. `process.exit` right after a write to a pipe drops whatever the pipe has
 * not taken yet, and a dashboard reading `skulkr map` through one got its JSON cut at 65,536 bytes.
 */
export const exitAfterFlush = (code) => {
  process.stdout.write('', () => process.exit(code));
};

/**
 * Keeps a write to a closed stdout or stderr from killing this process. A night outlives the service that started it
 * and read its output, and its night log holds every line anyway.
 */
export const tolerateClosedOutput = () => {
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
};
