/**
 * The fields a scour reviewer writes on each finding for triage (docs/scour.md, "A finding carries what triage
 * needs"), read from a finding's body or a matcher's JSON, and merged when a defect is sighted again.
 */
const SIZES = ['line', 'function', 'design'];
const CONFIDENCES = ['likely', 'sure'];
const SEVERITIES = ['', 'low', 'medium', 'high', 'critical'];

const line = (body, name) => new RegExp(`^[-*]\\s*(?:\\*\\*)?${name}(?::\\*\\*|\\*\\*:|:)\\s*(.+)$`, 'im').exec(body)?.[1].trim() ?? '';

const pathsIn = (text) => [...new Set(String(text).split(/[,\s]+/).map((p) => p.replace(/[`'"]/g, '').replace(/:\d+.*$/, '')).filter((p) => /[\w-]\.\w+$|\//.test(p)))];

/** The triage fields given in `raw` (a matcher's finding, or one parsed from a body), only those it has. */
export const triageFrom = (raw = {}) => {
  const out = {};
  const scenario = String(raw.scenario ?? '').trim();
  if (scenario) out.scenario = scenario;
  const fix = Array.isArray(raw.fix) ? raw.fix.flatMap(pathsIn) : pathsIn(raw.fix ?? '');
  if (fix.length) out.fix = fix;
  const size = String(raw.size ?? '').trim().toLowerCase().split(/\W/)[0];
  if (SIZES.includes(size)) out.size = size;
  const cause = String(raw.cause ?? '').trim();
  if (cause) out.cause = cause;
  const confidence = String(raw.confidence ?? '').trim().toLowerCase().split(/\W/)[0];
  if (CONFIDENCES.includes(confidence)) out.confidence = confidence;
  return out;
};

/** The triage fields a parsed finding's body gives. */
export const triageOf = (finding) => {
  const body = finding.body ?? '';
  return triageFrom({ scenario: line(body, 'scenario'), fix: line(body, 'fix'), size: line(body, 'size'), cause: line(body, 'cause'), confidence: line(body, 'confidence') });
};

const ranked = (order, a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a);

/**
 * A defect's fields once a further sighting's are folded in: the highest severity, the union of `fix` files, the
 * largest size, the strongest confidence, and the first sighting's scenario and cause where it gave them.
 */
export const mergedTriage = (defect, seen) => {
  const out = { ...defect };
  if (seen.severity) out.severity = ranked(SEVERITIES, defect.severity ?? '', seen.severity);
  if (!out.scenario && seen.scenario) out.scenario = seen.scenario;
  if (!out.cause && seen.cause) out.cause = seen.cause;
  if (seen.fix?.length) out.fix = [...new Set([...(defect.fix ?? []), ...seen.fix])];
  if (seen.size) out.size = defect.size ? ranked(SIZES, defect.size, seen.size) : seen.size;
  if (seen.confidence) out.confidence = defect.confidence ? ranked(CONFIDENCES, defect.confidence, seen.confidence) : seen.confidence;
  return out;
};

/** A defect's triage fields alone, for the registry; undefined when it has none. */
export const triageFieldsOf = (defect) => {
  const t = triageFrom(defect);
  return Object.keys(t).length ? t : undefined;
};
