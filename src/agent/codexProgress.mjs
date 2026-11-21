/**
 * A job's `codex exec --json` events on stdin, turned into onto progress on stdout, and the events skulkr reads back
 * (the agent's messages, the turn's end with its usage, any error) written to the result file; command output, which
 * holds whole files, is left out. Runs on the node, from `.skulkr/in`, so it imports nothing outside node itself.
 *
 *   node codexProgress.mjs <files.txt> <result.jsonl>   a reviewer: each listed file a command first names
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const KEPT = new Set(['turn.completed', 'turn.failed', 'error']);

/** Whether skulkr reads `event` back: an agent message, or the turn's end or failure. */
const kept = (event) => KEPT.has(event?.type) || (event?.type === 'item.completed' && event.item?.type === 'agent_message');

/**
 * Answers `feed(line)`, which takes one event line and answers `{ progress, keep }`: the progress line to print, if a
 * command named a listed file for the first time, and whether the line goes to the result file.
 */
export const createCodexProgress = (files) => {
  const listed = [...new Set(files)];
  const seen = new Set();
  const start = `onto: progress 0/${listed.length}`;
  const feed = (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { keep: false };
    }
    let progress;
    const command = event?.item?.type === 'command_execution' ? String(event.item.command ?? '') : '';
    for (const path of command ? listed : []) {
      if (seen.has(path) || !command.includes(path)) continue;
      seen.add(path);
      progress = `onto: progress ${seen.size}/${listed.length}`;
    }
    return { progress, keep: kept(event) };
  };
  return { start, feed };
};

const main = async ([filesPath, resultPath]) => {
  const files = readFileSync(filesPath, 'utf8').split('\n').filter(Boolean);
  const { start, feed } = createCodexProgress(files);
  process.stdout.write(`${start}\n`);
  const keptLines = [];
  for await (const line of createInterface({ input: process.stdin })) {
    const { progress, keep } = feed(line);
    if (progress) process.stdout.write(`${progress}\n`);
    if (keep) keptLines.push(line);
  }
  writeFileSync(resultPath, keptLines.length ? `${keptLines.join('\n')}\n` : '');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
