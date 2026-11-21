/**
 * Each area's icon on the map, from the config's `icons` (README "The config file"): an icon named for the area or a
 * group holding it, the most specific first, else the icon of the one package all its files lie in. The map carries
 * each icon's glyph, an SVG body on a 20×20 viewBox, since the dashboard draws whatever icon a config names.
 */

/** The config's `icons` for the project at `root`: it may be a function of the root, answering the table. */
export const iconsFor = (cfg, root) => {
  const spec = typeof cfg.icons === 'function' ? cfg.icons({ root }) : cfg.icons;
  return spec ?? null;
};

/**
 * The icon `icons` names for `area` (`{ id, files }`): the `areas` key that is its id or the longest dotted prefix
 * of it, where null means none; else, when every file lies in one package by `packageOf`, that package's icon from
 * `packages` (a table or a function).
 */
export const iconNameOf = (icons, area) => {
  let named;
  let longest = -1;
  for (const [key, name] of Object.entries(icons?.areas ?? {})) {
    if ((area.id === key || area.id.startsWith(`${key}.`)) && key.length > longest) [named, longest] = [name, key.length];
  }
  if (longest >= 0) return named ?? undefined;
  if (!icons?.packageOf || area.files.length === 0) return undefined;
  const owners = new Set(area.files.map((f) => icons.packageOf(f) ?? null));
  const [owner] = owners;
  if (owners.size !== 1 || owner === null) return undefined;
  return (typeof icons.packages === 'function' ? icons.packages(owner) : icons.packages?.[owner]) ?? undefined;
};

/**
 * Every area's icon name, by id, and the glyph of each name `icons.glyph` can draw; an area whose icon has no glyph
 * gets none.
 */
export const areaIcons = (icons, areas) => {
  const byArea = new Map();
  const glyphs = {};
  if (!icons) return { byArea, glyphs };
  for (const area of areas) {
    const name = iconNameOf(icons, area);
    if (name === undefined) continue;
    if (!(name in glyphs)) glyphs[name] = icons.glyph?.(name) ?? null;
    if (glyphs[name] !== null) byArea.set(area.id, name);
  }
  for (const [name, body] of Object.entries(glyphs)) if (body === null) delete glyphs[name];
  return { byArea, glyphs };
};
