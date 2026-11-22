#!/usr/bin/env node
/** Lucie: personal data that should not be in a repository. */
import { execFileSync } from 'node:child_process';
import { scanRepository } from '../src/scan.mjs';
import { KIND_LABELS, mask } from '../src/detectors.mjs';

const HELP = `Lucie · les données personnelles qui n'ont rien à faire dans un dépôt

Usage : lucie [options]

  Cherche dans les lignes ajoutées depuis une base (une PR), ou dans tout le dépôt :
  ✗ numéro de sécurité sociale, IBAN, carte bancaire (clé de contrôle vérifiée),
    fichier de données (CSV, SQL…) avec plusieurs vraies adresses e-mail
  ⚠ adresse e-mail, numéro de téléphone (les valeurs d'exemple sont ignorées), tableur ajouté

  --base <ref>   lignes ajoutées depuis cette branche ou ce commit (défaut : origin/main, sinon main)
  --tout         tout le dépôt, pas seulement les changements
  --json         résultat en JSON
  --aide         cette aide

Les valeurs trouvées sont masquées dans le rapport. Exception voulue : « lucie: autorisé » sur la
ligne, ou .lucie.json ({ "ignorer": ["docs/*"], "autorises": ["contact@exemple.org"] }).`;

const ADVICE = {
  secu: "Retirez-le du dépôt et de l'historique git (il reste dans les anciens commits), et prévenez la personne si le dépôt est public.",
  iban: "Retirez-le du dépôt et de l'historique git (il reste dans les anciens commits).",
  carte: "Retirez-le du dépôt et de l'historique git, et faites opposition si la carte est réelle.",
  email: "Si c'est une vraie personne, remplacez par une adresse d'exemple (prenom.nom@exemple.fr).",
  telephone: "Si c'est un vrai numéro, remplacez par un numéro factice (06 00 00 00 00).",
  'fichier-donnees': "Un export de vraies personnes n'a pas sa place dans le dépôt (RGPD) : utilisez des données inventées.",
};

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === 'verifier') continue;
    if (['aide', '--aide', '-h', '--help'].includes(argument)) options.help = true;
    else if (argument === '--base') options.base = args[++index];
    else if (argument === '--tout') options.everything = true;
    else if (argument === '--json') options.json = true;
    else throw new Error(`Option inconnue : ${argument}. Tapez « lucie --aide ».`);
  }
  return options;
}

function defaultBase(folder) {
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', candidate], { cwd: folder, stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error('Pas de branche main ni master ici : indiquez la base avec --base, ou lisez tout le dépôt avec --tout.');
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const folder = process.cwd();
  const base = options.everything ? null : options.base || defaultBase(folder);
  if (base) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: folder, stdio: 'ignore' });
    } catch {
      throw new Error(`Impossible de comparer avec « ${base} » : cette branche ou ce commit n'existe pas ici.`);
    }
  }
  const findings = scanRepository(folder, { base, everything: options.everything });
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const location = (finding) => (finding.lineNumber ? `${finding.path}:${finding.lineNumber}` : finding.path);
  const shown = (finding) => (finding.kind === 'fichier-donnees' ? finding.value : mask(finding.kind, finding.value));

  if (options.json) {
    const output = findings.map((finding) => ({ fichier: finding.path, ligne: finding.lineNumber, genre: finding.kind, niveau: finding.level === 'error' ? 'erreur' : 'avertissement', valeur: shown(finding) }));
    console.log(JSON.stringify({ constats: output, erreurs: errors, echec: errors > 0 }, null, 2));
  } else if (!findings.length) {
    console.log(`Aucune donnée personnelle ${options.everything ? 'dans le dépôt' : `dans les lignes ajoutées depuis ${base}`}.`);
  } else {
    for (const finding of findings) {
      console.log(`${finding.level === 'error' ? '✗' : '⚠'} ${location(finding)}  ${KIND_LABELS[finding.kind]} (${shown(finding)})`);
      console.log(`    ${ADVICE[finding.kind]}`);
    }
    console.log(`\n${findings.length} constat(s) · ${errors} bloquant(s)`);
  }
  if (process.env.GITHUB_ACTIONS) {
    for (const finding of findings) {
      const place = `file=${finding.path}${finding.lineNumber ? `,line=${finding.lineNumber}` : ''}`;
      console.log(`::${finding.level} ${place},title=Lucie · ${KIND_LABELS[finding.kind]}::${shown(finding)} — ${ADVICE[finding.kind]}`);
    }
  }
  if (errors) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`lucie : ${error.message}`);
  process.exit(1);
}
