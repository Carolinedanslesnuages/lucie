import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, mask, validNir, validIban, validCard } from '../src/detectors.mjs';

const BINARY = fileURLToPath(new URL('../bin/lucie.mjs', import.meta.url));

// Valid numbers are built at run time, so that this file holds none: Lucie can read her own repository.
const nirKey = (body) => String(97 - [...body].reduce((remainder, digit) => (remainder * 10 + Number(digit)) % 97, 0)).padStart(2, '0');
const NIR_BODY = ['1', '85', '05', '78', '006', '084'].join('');
const SOCIAL_SECURITY_NUMBER = `${NIR_BODY}${nirKey(NIR_BODY)}`;
const IBAN = ['FR76', '3000', '6000', '0112', '3456', '7890', '189'].join(' ');
const CARD = Array(4).fill('4242').join(' ');
const EMAIL = ['camille', 'durand'].join('.') + '@' + ['fournisseur', 'fr'].join('.');
const PHONE = ['06', '45', '81', '27', '93'].join(' ');

function repositoryWith(base, change) {
  const folder = mkdtempSync(join(tmpdir(), 'lucie-'));
  const runGit = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' });
  const write = (files) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), content);
    }
  };
  runGit('init', '-q', '-b', 'main');
  runGit('config', 'user.email', 'essai@exemple.fr');
  runGit('config', 'user.name', 'essai');
  write({ 'README.md': '# Projet\n', ...base });
  runGit('add', '-A');
  runGit('commit', '-q', '-m', 'base');
  runGit('switch', '-q', '-c', 'branche');
  write(change);
  runGit('add', '-A');
  runGit('commit', '-q', '-m', 'changement');
  return folder;
}
const runCli = (folder, ...args) => spawnSync(process.execPath, [BINARY, ...args], { cwd: folder, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
const findingsOf = (folder, ...args) => JSON.parse(runCli(folder, '--json', ...args).stdout).constats;

test('clés de contrôle : sécurité sociale (Corse comprise), IBAN, carte', () => {
  assert.ok(validNir(SOCIAL_SECURITY_NUMBER));
  assert.ok(!validNir(`${NIR_BODY}${String((Number(nirKey(NIR_BODY)) + 1) % 97).padStart(2, '0')}`));
  const corsicanBody = ['2', '85', '05', '2A', '006', '084'].join('');
  assert.ok(validNir(`${corsicanBody}${nirKey(corsicanBody.replace('2A', '19'))}`), 'département 2A');
  assert.ok(validIban(IBAN));
  assert.ok(!validIban(IBAN.replace(/189$/, '188')));
  assert.ok(validCard(CARD));
  assert.ok(!validCard(CARD.replace(/2$/, '1')));
  assert.ok(!validCard(Array(4).fill('0000').join(' ')), 'que des zéros');
});

test('détection : vraies données repérées, valeurs d’exemple ignorées', () => {
  const kinds = (line) => detect(line).map((finding) => finding.kind);
  assert.deepEqual(kinds(`Client ${EMAIL}, tél. ${PHONE}`), ['email', 'telephone']);
  assert.deepEqual(kinds(`NIR ${SOCIAL_SECURITY_NUMBER} IBAN ${IBAN} carte ${CARD}`), ['secu', 'iban', 'carte']);
  for (const placeholder of ['essai@exemple.fr', 'contact@ma-boite.fr', 'noreply@github.com', 'dev@example.com', '06 00 00 00 00', '06 12 34 56 78', 'version 1.2.3', '2026-11-22', 'sha 4b825dc642cb6eb9a060e54bf8d69288fbee4904']) {
    assert.deepEqual(kinds(placeholder), [], placeholder);
  }
});

test('masquage : la valeur n’est jamais reprise en entier', () => {
  assert.equal(mask('email', EMAIL), `c•••@${['fournisseur', 'fr'].join('.')}`);
  assert.equal(mask('iban', IBAN), 'FR76 •••• 189');
  assert.equal(mask('carte', CARD), '•••• 4242');
  const output = runCli(repositoryWith({}, { 'src/client.js': `const owner = '${EMAIL}'; // ${SOCIAL_SECURITY_NUMBER}\n` }), '--base', 'main').stdout;
  assert.ok(!output.includes(EMAIL) && !output.includes(SOCIAL_SECURITY_NUMBER), output);
});

test('PR : seules les lignes ajoutées ; numéros bloquants, e-mail et téléphone en avertissement', () => {
  const folder = repositoryWith({ 'src/old.js': `// ${EMAIL}\n` }, { 'src/client.js': `const iban = '${IBAN}';\nconst phone = '${PHONE}';\n` });
  const result = runCli(folder, '--base', 'main');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗ src\/client\.js:1 {2}IBAN \(FR76 •••• 189\)\n {4}Retirez-le du dépôt et de l'historique git/);
  assert.match(result.stdout, /⚠ src\/client\.js:2 {2}numéro de téléphone/);
  assert.doesNotMatch(result.stdout, /old\.js/, 'ligne d’avant la PR : ignorée');
  assert.equal(runCli(repositoryWith({}, { 'src/a.js': `// ${EMAIL}\n` }), '--base', 'main').status, 0, 'un e-mail seul ne bloque pas');
});

test('fichier de données avec de vraies adresses : un constat bloquant pour tout le fichier ; tableur signalé', () => {
  const rows = ['nom,email', ...['alice', 'bruno', 'chloe'].map((name) => `${name},${name}.martin@${['fournisseur', 'fr'].join('.')}`)].join('\n');
  const findings = findingsOf(repositoryWith({}, { 'exports/clients.csv': `${rows}\n`, 'docs/plan.xlsx': 'PK' }), '--base', 'main');
  assert.deepEqual(findings.map((finding) => [finding.fichier, finding.genre, finding.niveau]), [
    ['exports/clients.csv', 'fichier-donnees', 'erreur'],
    ['docs/plan.xlsx', 'fichier-donnees', 'avertissement'],
  ]);
});

test('exceptions : « lucie: autorisé » sur la ligne, .lucie.json (dossiers ignorés, valeurs autorisées)', () => {
  assert.deepEqual(findingsOf(repositoryWith({}, { 'src/a.js': `// ${EMAIL} lucie: autorisé, adresse publique du projet\n` }), '--base', 'main'), []);
  const settings = JSON.stringify({ ignorer: ['fixtures/**'], autorises: [EMAIL.toUpperCase()] });
  const folder = repositoryWith({ '.lucie.json': settings }, { 'fixtures/a.txt': `${IBAN}\n`, 'src/a.js': `// ${EMAIL}\n` });
  assert.deepEqual(findingsOf(folder, '--base', 'main'), []);
});

test('--tout : tout le dépôt ; erreurs claires', () => {
  const folder = repositoryWith({ 'src/old.js': `// ${CARD}\n` }, { 'src/b.js': '// rien\n' });
  assert.deepEqual(findingsOf(folder, '--tout').map((finding) => finding.genre), ['carte']);
  assert.match(runCli(folder, '--base', 'nulle-part').stderr, /Impossible de comparer avec « nulle-part »/);
  assert.match(runCli(folder, '--nimporte').stderr, /Option inconnue/);
  assert.match(runCli(folder, '--base', 'main').stdout, /Aucune donnée personnelle dans les lignes ajoutées depuis main/);
});
