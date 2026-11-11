# Vérification QA indépendante : confirmation d'un retrait autorisé (#47)

Ce script exécute les lignes K1 à K14 de
[`../integration/matrice-retrait-retour.md`](../integration/matrice-retrait-retour.md). Il les
confronte aux deux règles validées par Philippe le 11 novembre et aux documents normatifs
05 §5.4-5.5 et 06 §10 et §14.2.

```bash
docs/qualite/checkout-confirmation/run.sh                 # depuis la racine du dépôt, environ 25 minutes
QA_CHK_CASES="C1 C3" docs/qualite/checkout-confirmation/run.sh   # quelques cas seulement
```

## Méthode

- **Une pile par cas.** Le script recrée une pile jetable pour chaque cas, afin qu'aucun prêt,
  anomalie ou réservation ne déborde sur le cas suivant. Elle comprend PostgreSQL, Mosquitto avec
  son ACL, et l'API construite depuis le commit extrait. Le projet Compose est
  `aegis-qa-checkout`, sur les ports 58543, 54994 et 19391.
- **Le chemin réel jusqu'à la commande.** Chaque cas passe par la préparation, l'affichage et le
  scan du QR (#43, #44, #46). Le token est déchiffré depuis la ligne scellée dans une variable du
  shell, puis transmis par l'entrée standard ; il n'est jamais écrit ni affiché.
- **Le hub est simulé** par `tools/hub-simulator`. Il reçoit le vrai `UNLOCK_COMPARTMENT`,
  l'accuse, puis rejoue un scénario : porte, tags et état du lecteur.
- **Le code de sortie** est le nombre de lignes `FAIL`, lignes `BLOCKED` comprises. Les lignes
  `OBS` sont des constats destinés au propriétaire du contrat.

## Cas

| Cas | Matrice | Scénario simulé | Attendu |
|---|---|---|---|
| C1 | K1, K9 | Ouverture, tag retiré, fermeture ; puis l'accusé, les portes et le scan rejoués avec le même `messageId` | `CONFIRMED`, réservation `FULFILLED`, un prêt `ACTIVE` avec `dueAt = reservedUntil` ; un seul audit `OPERATION_CONFIRMED` après les rejeux |
| C2 | K2 à K4 | Règle 1 : fermeture avec le tag attendu toujours présent | `OBSERVATION_RECEIVED` à `expiresAt − 1,5 s` ; `ANOMALY` / `INCONSISTENT_PHYSICAL_STATE` dans les 2,5 s après `expiresAt` ; une seule anomalie et un seul audit malgré les passes répétées |
| C3 | K5 | Règle 2 : lecteur `FAULTED` au scan de fermeture | `ANOMALY` / `INCONSISTENT_PHYSICAL_STATE` aussitôt, bien avant `expiresAt` |
| C4 | K6 | Règle 2 : lecteur `UNKNOWN` au scan de fermeture | Comme C3 |
| C5 | K7 | Scan `FAULTED` porte ouverte, puis scan sain après la fermeture | Pas de règle 2 : `CONFIRMED` |
| C6 | K8, K11 | Porte refermée 115 s après le déverrouillage ; le scan de 10 s se termine après `expiresAt` | `ANOMALY` / `DEVICE_OFFLINE_DURING_OPERATION` à l'échéance ; le scan tardif sain, sans le tag, ne change rien |
| C7 | doc 05 §5.5 | Même séquence, passe d'évaluation à 5 min (`AEGIS_OPERATIONS_EVALUATION_INTERVAL=PT5M`) | Une preuve reçue après `expiresAt` ne confirme pas : la livraison ne prolonge aucun délai |
| C8 | K14 | Tag attendu retiré, tag étranger laissé dans la cellule | Doc 05 §5.4 : `UNEXPECTED_ASSET_OBSERVED` ; doc 06 §10.3 vérifie d'abord l'absence du tag attendu. Constat (`OBS`) en cas d'écart |
| C9 | K8 | Hub coupé (Last Will) après la fermeture, avant son scan | L'absence de message n'est pas une preuve : `ANOMALY` / `DEVICE_OFFLINE_DURING_OPERATION` à l'échéance |

Chaque cas vérifie aussi qu'il y a au plus une commande, et un prêt seulement pour une opération
`CONFIRMED`.

## Non couvert

- **K10 (hors ordre) et K13 (autre opération ou autre cellule).** Ils exigent de forger des
  scans RFID complets ; ils restent couverts par les tests Backend (`CheckoutProofTests`,
  `CheckoutConfirmationApiTests`).
- **K12 (scan après `CONFIRMED`).** Le simulateur ne rattache plus un scan à l'opération une fois
  la séquence terminée, donc ce cas n'est pas démontrable ici.
- **Matériel réel.** Rien de tout cela ne prouve le comportement d'un écran, d'une serrure ou d'un
  lecteur réels.
