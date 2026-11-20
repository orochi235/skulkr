/**
 * `setTimeout` for a delay of any length: one past 2^31 − 1 ms is waited out in steps (a bare `setTimeout` fires it at
 * once), and `Infinity` never fires. Answers a function that cancels it.
 */
const MAX = 2 ** 31 - 1;

export const after = (ms, fn) => {
  let timer;
  let canceled = false;
  const wait = (left) => {
    if (canceled || left === Infinity) return;
    timer = setTimeout(() => (left > MAX ? wait(left - MAX) : fn()), Math.max(0, Math.min(left, MAX)));
  };
  wait(Number.isNaN(ms) ? 0 : ms);
  return () => {
    canceled = true;
    clearTimeout(timer);
  };
};
