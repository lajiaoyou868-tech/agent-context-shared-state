import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const allowedRoots = new Set(['.github', 'docs', 'examples', 'scripts', 'src', 'templates', 'test']);
const allowedFiles = new Set(['README.md', 'LICENSE', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes']);
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/],
  ['api-token', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['secret-assignment', /(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"'\s]{8,}["']/i],
  ['absolute-windows-path', /\b[A-Za-z]:[\\/][^\s"'<>]+/],
  ['personal-unix-path', /\/(?:Users|home)\/[^/\s"']+\//],
  ['conversation-link', /(?:chatgpt-conversation|codex):\/\//],
  ['uuid-identifier', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['credential-url', /https?:\/\/[^/\s:@]+:[^/\s@]+@/],
];
export function inspectText(text) { return patterns.filter(([, expression]) => expression.test(text)).map(([name]) => name); }

function collect(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (directory === root && ['.git', 'node_modules', 'project-control'].includes(entry.name)) return [];
    const location = join(directory, entry.name);
    return entry.isDirectory() ? collect(location) : [relative(root, location).split('\\').join('/')];
  });
}

export function scan() {
  const ownGit = lstatSafe(join(root, '.git'));
  const git = ownGit ? spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true }) : null;
  if (git && git.status !== 0) throw new Error('GIT_FILE_INVENTORY_FAILED');
  const files = [...new Set(git ? git.stdout.split('\0').filter(Boolean) : collect())].sort();
  const findings = [];
  for (const file of files) {
    const parts = file.split('/');
    if ((!allowedRoots.has(parts[0]) && !allowedFiles.has(file)) ||
        /(?:^|\/)(?:\.env(?:\.|$)|node_modules|project-control|logs?)(?:\/|$)|\.(?:db|sqlite)(?:-|$)|\.log$/i.test(file)) {
      findings.push({ file, check: 'unexpected-publishable-path' });
      continue;
    }
    const location = join(root, file);
    if (parts.some((_, index) => lstatSafe(join(root, ...parts.slice(0, index + 1)))?.isSymbolicLink())) {
      findings.push({ file, check: 'symlink' }); continue;
    }
    const info = lstatSafe(location);
    if (!info?.isFile() || info.size > 1024 * 1024) { findings.push({ file, check: 'missing-or-oversized-file' }); continue; }
    const bytes = readFileSync(location);
    if (bytes.includes(0)) { findings.push({ file, check: 'binary-file' }); continue; }
    for (const check of inspectText(bytes.toString('utf8'))) findings.push({ file, check });
  }
  return { scanned_files: files.length, findings, scope: 'publishable worktree files; heuristic scan, not proof of absence' };
}
function lstatSafe(location) { try { return lstatSync(location); } catch { return undefined; } }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scan();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.findings.length) process.exitCode = 1;
}
