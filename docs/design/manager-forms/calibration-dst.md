# Échéance de calibration et changement d'heure

> **Décision humaine** de Philippe, confirmée le 6 novembre 2026
> ([#25](https://github.com/PhilJordan18/aegis/issues/25#issuecomment-6689754663)) :
> aucune conversion silencieuse. Elle porte sur la saisie datée de l'échéance de
> calibration, pas sur l'algorithme de l'horaire hebdomadaire. Elle ne modifie
> ni un ADR accepté ni la sémantique REST : `calibrationDueAt` reste un instant
> UTC (09 §12.2).

L'échéance se saisit en date et heure murales dans le fuseau du laboratoire
(`America/Toronto`), puis est convertie en instant.

| Heure saisie | Comportement |
|---|---|
| Normale (ex. 2027-01-15 09:30) | Un seul instant, envoyé tel quel |
| Sautée au printemps (ex. 2026-03-08 02:30) | Refusée sur le champ : « Cette heure n'existe pas ce jour-là… Choisissez une autre heure. » Aucun décalage vers 03:30, aucune requête |
| Répétée à l'automne (ex. 2026-11-01 01:30) | Un groupe de deux radios, aucun présélectionné : « La première : 01 h 30 HAE (UTC−04:00) » et « La seconde : 01 h 30 HNE (UTC−05:00) ». Sans choix, erreur sur le groupe et aucune requête; avec un choix, l'instant choisi est envoyé |
| Date impossible (ex. 2026-02-30) | « Valeur non valide. » |

La conversion n'a lieu qu'après le choix et conserve l'instant choisi.
En modification, une échéance déjà enregistrée dans l'heure répétée présélectionne
son occurrence; si rien n'est changé, l'instant exact du serveur est renvoyé.
Changer l'heure efface le choix précédent.

Le fuseau, l'abréviation (HAE/HNE, EDT/EST) et le décalage UTC sont toujours
affichés, en français comme en anglais.

## Preuves

- `apps/admin-web/src/i18n/zonedTime.test.ts` : date normale, trou du printemps,
  les deux occurrences d'automne, date invalide, allers-retours, autre fuseau.
- `apps/admin-web/src/pages/EquipmentPage.forms.test.tsx` : refus sans requête,
  choix obligatoire puis instant exact envoyé, libellés FR et EN, occurrence
  conservée en modification.
- `e2e/forms.spec.ts` (« calibration due ») : axe WCAG A/AA, clavier, 320 px,
  clair et sombre; rendus `captures/unit-form-dst-*.png` (4).
