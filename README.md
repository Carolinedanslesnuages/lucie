# Lucie

Les données personnelles qui n'ont rien à faire dans un dépôt.

Un agent qui prépare des données d'essai prend volontiers celles qu'il a sous la main : un export
de clients, un vrai IBAN, l'adresse d'une collègue. Une fois commitées, elles restent dans
l'historique git, même après suppression du fichier. Lucie les repère avant la fusion.

```text
✗ exports/clients.csv  fichier de données personnelles (12 adresses e-mail)
    Un export de vraies personnes n'a pas sa place dans le dépôt (RGPD) : utilisez des données inventées.
✗ src/paiement.ts:42  IBAN (FR76 •••• 189)
    Retirez-le du dépôt et de l'historique git (il reste dans les anciens commits).
⚠ test/compte.test.ts:8  adresse e-mail (c•••@fournisseur.fr)
    Si c'est une vraie personne, remplacez par une adresse d'exemple (prenom.nom@exemple.fr).
```

## Ce que Lucie cherche

| Donnée | Effet | Comment |
|---|---|---|
| Numéro de sécurité sociale | ✗ bloque | Clé de contrôle vérifiée (Corse comprise) : des chiffres au hasard ne comptent pas. |
| IBAN | ✗ bloque | Clé de contrôle vérifiée (modulo 97). |
| Numéro de carte bancaire | ✗ bloque | Clé de Luhn vérifiée. |
| Fichier de données (CSV, SQL, JSONL…) avec au moins 3 vraies adresses | ✗ bloque | Un seul constat pour tout le fichier. |
| Adresse e-mail | ⚠ avertit | Les adresses d'exemple (`exemple.fr`, `example.com`, `noreply`, `contact@`…) sont ignorées. |
| Numéro de téléphone français (06, 07, +33) | ⚠ avertit | Les numéros factices (`06 00 00 00 00`, `06 12 34 56 78`…) sont ignorés. |
| Tableur ajouté (`.xlsx`, `.ods`…) | ⚠ avertit | Illisible en texte : à vérifier à la main. |

**Les valeurs trouvées sont masquées** dans le rapport et les annotations (`c•••@fournisseur.fr`,
`FR76 •••• 189`) : Lucie ne fait pas fuiter une seconde fois ce qu'elle trouve, dans les
journaux de la CI par exemple.

**Ce que Lucie ne voit pas** : les noms, prénoms et adresses postales (trop proches du texte
ordinaire pour être repérés sans se tromper), les données dans les images ou les PDF, et ce qui
est déjà dans l'historique (lancez `lucie --tout` sur une ancienne version pour vérifier).

## Exceptions

- Sur la ligne : `lucie: autorisé`, avec la raison (`// lucie: autorisé, adresse publique du projet`).
- Dans `.lucie.json` :

```json
{
  "ignorer": ["docs/exemples/**"],
  "autorises": ["contact@mon-projet.fr"]
}
```

## Dans une pull request (GitHub Actions)

```yaml
jobs:
  donnees:
    name: Données personnelles (Lucie)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: Carolinedanslesnuages/lucie@v1
```

Seules les lignes ajoutées par la PR sont lues. `tout: "true"` lit tout le dépôt.

## Sur votre ordinateur

```sh
npx github:Carolinedanslesnuages/lucie           # les lignes ajoutées depuis main
npx github:Carolinedanslesnuages/lucie --tout    # tout le dépôt
```

Sans dépendance. Rien n'est envoyé : Lucie lit seulement les fichiers du dossier courant.

## Si Lucie trouve quelque chose

Supprimer le fichier ne suffit pas : la donnée reste dans l'historique git. Il faut réécrire
l'historique (par exemple avec [git filter-repo](https://github.com/newren/git-filter-repo)),
et, pour un dépôt public, considérer la donnée comme déjà copiée : changer ce qui peut l'être,
prévenir les personnes concernées.

## Pourquoi Lucie

[Lucie Aubrac](https://fr.wikipedia.org/wiki/Lucie_Aubrac), résistante, cofondatrice du
mouvement Libération-Sud. Dans la Résistance, protéger l'identité des personnes était une
question de vie ou de mort.

## Développer Lucie

```sh
npm test
```

Les numéros valides des tests sont construits à l'exécution : le dépôt de Lucie n'en contient
aucun, et Lucie se vérifie elle-même dans sa CI.

## Licence

[MIT](LICENSE).
