/**
 * Detectors of personal data in a line of text. Numbers with a check key (French social security
 * number, IBAN, payment card) are only reported when the key is valid: random digits are not.
 * Each finding: { kind, level, value }. Kind ids are public (--json, .lucie.json): in French.
 */

/** Example or technical addresses that are not personal data. */
const PLACEHOLDER_EMAIL = /@(example|exemple|test|localhost|domain|domaine|email|mail)\.|@(.*\.)?(example|invalid|test|local|localhost)$|noreply|no-reply|users\.noreply\.github\.com$|^(contact|hello|bonjour|support|admin|info|team|equipe|security|securite|webmaster|postmaster|abuse|dpo|rgpd)@/i;
const FAKE_PHONE = /^0[67](0{8}|12345678|98765432|11111111|(\d)\6{7})$/;

const digitsOnly = (text) => text.replace(/\D/g, '');

/** Remainder of a long decimal number modulo 97, computed in pieces (no BigInt needed). */
function modulo97(digits) {
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

/** French social security number (NIR): 13 digits and a key, key = 97 − (number mod 97). Corsica (2A/2B) included. */
export function validNir(text) {
  const compact = text.replace(/\s/g, '').toUpperCase();
  const match = /^([12])(\d{2})(0[1-9]|1[0-2]|[2-9]\d)(\d{2}|2A|2B)(\d{3})(\d{3})(\d{2})$/.exec(compact);
  if (!match) return false;
  const body = compact.slice(0, 13).replace('2A', '19').replace('2B', '18');
  return 97 - modulo97(body) === Number(match[7]);
}

/** IBAN: letters moved to the end and converted to numbers, the whole must be 1 modulo 97. */
export function validIban(text) {
  const compact = text.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = (compact.slice(4) + compact.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  return modulo97(rearranged) === 1;
}

/** Payment card number: 13 to 19 digits that pass the Luhn check. */
export function validCard(text) {
  const digits = digitsOnly(text);
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let total = 0;
  [...digits].reverse().forEach((digit, index) => {
    let value = Number(digit);
    if (index % 2 === 1) value = value * 2 > 9 ? value * 2 - 9 : value * 2;
    total += value;
  });
  return total % 10 === 0;
}

const DETECTORS = [
  { kind: 'secu', level: 'error', pattern: /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}\b/gi, valid: validNir },
  { kind: 'iban', level: 'error', pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4}\b/g, valid: validIban },
  { kind: 'carte', level: 'error', pattern: /\b\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b/g, valid: validCard },
  { kind: 'email', level: 'warning', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, valid: (value) => !PLACEHOLDER_EMAIL.test(value) },
  { kind: 'telephone', level: 'warning', pattern: /(?<![\d.])(?:\+33\s?|0033\s?|0)[67](?:[\s.-]?\d{2}){4}(?![\d.])/g, valid: (value) => !FAKE_PHONE.test(`0${digitsOnly(value).slice(-9)}`) },
];

export const KIND_LABELS = {
  secu: 'numéro de sécurité sociale',
  iban: 'IBAN',
  carte: 'numéro de carte bancaire',
  email: 'adresse e-mail',
  telephone: 'numéro de téléphone',
  'fichier-donnees': 'fichier de données personnelles',
};

/** Personal data found in a line. A value is only reported once, under its first matching kind. */
export function detect(line) {
  const findings = [];
  const seen = [];
  for (const detector of DETECTORS) {
    for (const match of line.matchAll(detector.pattern)) {
      const value = match[0].trim();
      if (seen.some((range) => match.index < range[1] && match.index + match[0].length > range[0])) continue;
      if (!detector.valid(value)) continue;
      seen.push([match.index, match.index + match[0].length]);
      findings.push({ kind: detector.kind, level: detector.level, value });
    }
  }
  return findings;
}

/** Masks a value so the report never leaks it again: "c•••@gmail.com", "FR76 •••• 189", "•••• 4242". */
export function mask(kind, value) {
  if (kind === 'email') {
    const [local, domain] = value.split('@');
    return `${local[0]}•••@${domain}`;
  }
  const compact = value.replace(/\s/g, '');
  if (kind === 'iban') return `${compact.slice(0, 4)} •••• ${compact.slice(-3)}`;
  return `•••• ${compact.slice(-4)}`;
}
