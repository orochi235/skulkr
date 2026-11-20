/**
 * Splits the project's source into audit areas of at most `partition.maxFiles` files, by directory. An area's id
 * is its directory's path (through the config's `areaId`), so regenerating keeps the id of every directory whose
 * shape did not change.
 *
 *   skulk partition [--ref <commit>]   # writes <record.dir>/partition.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const tree = () => ({ files: [], dirs: new Map(), count: 0 });

const build = (cfg, paths) => {
  const roots = new Map();
  for (const path of paths) {
    const root = path.match(cfg.partition.rootRe)[1];
    if (!roots.has(root)) roots.set(root, tree());
    let node = roots.get(root);
    node.count++;
    const parts = path.slice(root.length + 1).split('/');
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, tree());
      node = node.dirs.get(part);
      node.count++;
    }
    node.files.push(path);
  }
  return roots;
};

const allFiles = (node) => [...node.files, ...[...node.dirs.values()].flatMap(allFiles)];

const chunk = (max, id, files) => {
  if (files.length <= max) return [{ id, files }];
  const parts = Math.ceil(files.length / max);
  const size = Math.ceil(files.length / parts);
  return Array.from({ length: parts }, (_, i) => ({ id: `${id}.part${i + 1}`, files: files.slice(i * size, (i + 1) * size) }));
};

const split = (p, dir, node) => {
  if (node.count <= p.maxFiles) return [{ id: p.areaId(dir), files: allFiles(node).sort() }];
  const own = [...node.files];
  const areas = [];
  for (const [name, child] of [...node.dirs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (child.count < p.minFiles) own.push(...allFiles(child));
    else areas.push(...split(p, `${dir}/${name}`, child));
  }
  return own.length > 0 ? [...chunk(p.maxFiles, p.areaId(dir), own.sort()), ...areas] : areas;
};

/** The areas `paths` (repo-relative, any order) fall into, sorted by id. */
export const partition = (cfg, paths) => {
  const roots = build(cfg, [...new Set(paths)].filter(cfg.partition.isSource).sort());
  return [...roots].flatMap(([dir, node]) => split(cfg.partition, dir, node)).sort((a, b) => (a.id < b.id ? -1 : 1));
};

export const partitionAt = (cfg, root, ref = 'HEAD') => {
  const spec = cfg.partition.pathspec;
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', ref, ...(spec.length ? ['--', ...spec] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return partition(cfg, out.split('\0').filter(Boolean));
};

export const writePartition = (cfg, root, areas) => {
  const at = join(root, cfg.partition.path);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, `${JSON.stringify(areas, null, 1)}\n`);
  return at;
};

/** `skulk partition`: rewrites the partition file at `ref`. */
export const partitionCommand = (cfg, root, argv) => {
  const refAt = argv.indexOf('--ref');
  const areas = partitionAt(cfg, root, refAt < 0 ? 'HEAD' : argv[refAt + 1]);
  const at = writePartition(cfg, root, areas);
  const sizes = areas.map((a) => a.files.length);
  console.log(`partition: ${areas.length} areas, ${sizes.reduce((s, n) => s + n, 0)} files, ${Math.min(...sizes)}–${Math.max(...sizes)} per area → ${at}`);
};
