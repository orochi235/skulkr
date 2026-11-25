/**
 * `skulkr fetch [--every S]`: keeps the runner's fleet listings fresh in its cache, asking every `S` seconds (5 by
 * default) after the last ask ends, until stdin closes, so a dashboard's map builds (`map --cached-jobs`) never wait
 * on the fleet. Does nothing for a runner that keeps no listings. README "The dashboard" documents it.
 */
import { jobsSinceOf } from './map.mjs';

export const FETCH_EVERY_S = 5;

/** Asks `runner` for fresh listings once: since the earliest run the map shows, else the last day. */
export const fetchOnce = (cfg, runner, now = Date.now) => {
  runner.refresh?.(jobsSinceOf(cfg.state) ?? new Date(now() - 86_400_000).toISOString());
};

/**
 * Runs {@link fetchOnce} every `--every` seconds until `until` resolves (stdin closing, unless given); answers when it
 * has.
 * @param {any} cfg @param {any} runner @param {string[]} argv @param {Promise<unknown> | null} [until]
 */
export const fetchCommand = async (cfg, runner, argv, until = null) => {
  const at = argv.indexOf('--every');
  const every = at >= 0 ? Number(argv[at + 1]) : FETCH_EVERY_S;
  if (!Number.isFinite(every) || every <= 0) throw new Error(`--every wants a number of seconds, not ${argv[at + 1]}`);
  if (!runner.refresh) return;
  const stop = until ?? stdinClosed();
  let done = false;
  void stop.then(() => { done = true; });
  while (!done) {
    fetchOnce(cfg, runner);
    await Promise.race([new Promise((r) => setTimeout(r, every * 1000)), stop]);
  }
};

/** Resolves once stdin ends: the process that started this one closed it, or exited. */
const stdinClosed = () => new Promise((resolve) => {
  process.stdin.on('end', resolve).on('close', resolve).on('error', resolve);
  process.stdin.resume();
});
