/**
 * Reads a repository for personal data: the lines added since a base (a pull request), or every
 * tracked file (--tout). Data files (CSV, SQL…) holding several real e-mail addresses are reported
 * once, as a whole: they look like an export of real people.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from './detectors.mjs';

const runGit = (args, folder) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const SKIPPED = /(^|\/)(node_modules|dist|\.git)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|go\.sum)$|\.min\.(js|css)$|\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|woff2?|ttf|mp4|mp3)$/i;
const DATA_FILE = /\.(csv|tsv|sql|ndjson|jsonl)$/i;
const SPREADSHEET = /\.(xlsx?|ods|numbers)$/i;
const DATA_FILE_EMAILS = 3;
const EXCEPTION = /lucie\s*:\s*autoris/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Settings from .lucie.json: { "ignorer": ["docs/*"], "autorises": ["contact@exemple.org"] }. */
export function readSettings(folder) {
  const path = join(folder, '.lucie.json');
  if (!existsSync(path)) return { ignorer: [], autorises: [] };
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    return { ignorer: settings.ignorer || [], autorises: (settings.autorises || []).map((value) => String(value).toLowerCase()) };
  } catch (error) {
    throw new Error(`.lucie.json illisible : ${error.message}`);
  }
}

const globPattern = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

/** Lines to read: [{ path, lineNumber, text }]. */
function linesToRead(folder, { base, everything }) {
  if (everything) {
    return runGit(['ls-files'], folder).split('\n').filter(Boolean).flatMap((path) => {
      const fullPath = join(folder, path);
      if (SKIPPED.test(path) || !existsSync(fullPath)) return [];
      const info = statSync(fullPath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return []; // submodules are directories
      const content = readFileSync(fullPath);
      if (content.includes(0)) return []; // binary file
      return content.toString('utf8').split('\n').map((text, index) => ({ path, lineNumber: index + 1, text }));
    });
  }
  const lines = [];
  let path = null;
  let lineNumber = 0;
  for (const line of runGit(['diff', '-U0', '--no-color', base, 'HEAD'], folder).split('\n')) {
    if (line.startsWith('+++ ')) {
      path = line.startsWith('+++ b/') ? line.slice(6) : null;
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)/.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (!path || !line.startsWith('+')) continue;
    if (!SKIPPED.test(path)) lines.push({ path, lineNumber, text: line.slice(1) });
    lineNumber++;
  }
  return lines;
}

/** Spreadsheets cannot be read as text: a new one is reported, to be checked by hand. */
function addedSpreadsheets(folder, { base, everything }) {
  const paths = everything ? runGit(['ls-files'], folder) : runGit(['diff', '--name-only', '--diff-filter=A', base, 'HEAD'], folder);
  return paths.split('\n').filter((path) => SPREADSHEET.test(path));
}

/** Findings: [{ path, lineNumber, kind, level, value }]. */
export function scanRepository(folder, options) {
  const settings = readSettings(folder);
  const ignored = settings.ignorer.map(globPattern);
  const findings = [];
  for (const { path, lineNumber, text } of linesToRead(folder, options)) {
    if (ignored.some((pattern) => pattern.test(path)) || EXCEPTION.test(text)) continue;
    for (const finding of detect(text)) {
      if (settings.autorises.includes(finding.value.toLowerCase())) continue;
      findings.push({ path, lineNumber, ...finding });
    }
  }
  // A data file with several real addresses: one error for the whole file instead of one warning per line.
  const byDataFile = new Map();
  for (const finding of findings.filter((candidate) => DATA_FILE.test(candidate.path) && candidate.kind === 'email')) {
    byDataFile.set(finding.path, (byDataFile.get(finding.path) || 0) + 1);
  }
  const dataFiles = [...byDataFile].filter(([, count]) => count >= DATA_FILE_EMAILS);
  const result = findings.filter((finding) => !dataFiles.some(([path]) => path === finding.path && finding.kind === 'email'));
  for (const [path, count] of dataFiles) result.push({ path, lineNumber: null, kind: 'fichier-donnees', level: 'error', value: `${count} adresses e-mail` });
  for (const path of addedSpreadsheets(folder, options)) {
    if (!ignored.some((pattern) => pattern.test(path))) result.push({ path, lineNumber: null, kind: 'fichier-donnees', level: 'warning', value: 'tableur (non lu)' });
  }
  return result;
}
