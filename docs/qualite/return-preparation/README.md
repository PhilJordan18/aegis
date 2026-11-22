# Vérification QA indépendante : retour d'un prêt (#50, #51)

Ce script vérifie le retour d'un prêt :
- les cas D, pour #50 (RET-01) : préparation, autorisation, puis conclusion à l'échéance ;
- les cas E, pour #51 (RET-02) : preuve positive qui clôt le prêt.

- **Lignes couvertes :** T1 à T5 de
  [`../integration/matrice-retrait-retour.md`](../integration/matrice-retrait-retour.md).
- **Références :**
  - doc 06 §13.1, avec l'ordre de conclusion RET-01 ajouté par Backend ;
  - doc 09 §8.10 et §15.2 ;
  - doc 05 §7 (un retour n'exige pas un actif `READY`).

Les références de #51 sont doc 06 §10.3.2 et §12, et doc 09 §8.5.

```bash
docs/qualite/return-preparation/run.sh        # #50 seul (D1 à D8), depuis la racine du dépôt, environ 30 minutes
QA_RET_CASES="D1 D3 D4 D5 D6 D7 D8 E1 E2 E3 E4 E5 E6" docs/qualite/return-preparation/run.sh   # avec #51
```

Avec #51, D2 ne s'applique plus : le dépôt de l'actif y est prouvé, ce que vérifie E1.

## Méthode

- **Une pile par cas.** Le script recrée pour chaque cas une pile jetable :
  - PostgreSQL ;
  - Mosquitto avec son ACL ;
  - l'API construite depuis le commit extrait.

  Le projet Compose est `aegis-qa-return`, sur les ports 58553, 55004 et 19401.
- **Un vrai prêt d'abord.** Chaque cas passe par un vrai retrait (#43, #44, #46, #47) jusqu'à `CONFIRMED`. Il prépare
  ensuite le retour, attend l'affichage et scanne le vrai QR. Les tokens sont déchiffrés depuis la ligne scellée dans une
  variable du shell, puis transmis par l'entrée standard ; ils ne sont jamais écrits ni affichés.
- **Le hub est simulé** par `tools/hub-simulator`. Il reçoit les vrais `UNLOCK_COMPARTMENT` et rejoue la partie
  physique de chaque cas. Le script ne prépare le retour qu'après la trace d'un heartbeat rejoué, posée juste avant
  les étapes du cas. Sans ce repère, un retour autorisé trop tôt atteint un hub qui n'a pas encore armé la panne du
  cas D4.
- **Le code de sortie** est le nombre de lignes `FAIL`, lignes `BLOCKED` comprises. Les lignes `OBS` sont des constats
  destinés au propriétaire du contrat.

## Cas

| Cas | Matrice | Scénario simulé | Attendu |
|---|---|---|---|
| D1 | T1 | Actif emprunté (non `READY`), prêt rendu en retard par injection en base, retour préparé, rejoué, puis scanné ; la porte ne s'ouvre jamais | `RETURN` offert malgré le retard. Préparation `202` : opération `RETURN` sur `loanId`, sans `reservationId`, prêt encore `ACTIVE`, aucune commande. Même clé : même opération ; nouvelle clé : `409`. Défi d'action `RETURN`. Après le scan : prêt `RETURN_PENDING`, une commande, `expiresAt = authorizedAt + 120 s`. À l'échéance : `EXPIRED OPERATION_EXPIRED`, prêt `ACTIVE`, un audit `LOAN_RETURN_REVERTED_SAFE`, `RETURN` de nouveau offert |
| D2 | T3, T5 | Actif remis dans la cellule, porte refermée | Aucune conclusion anticipée. À l'échéance : `ANOMALY`, prêt `RETURN_PENDING`, anomalie `OPEN`. Nouveau retour refusé (`409 LOAN_NOT_RETURNABLE`) et aucune action offerte |
| D3 | T4 | Porte ouverte et laissée ouverte | `ANOMALY DOOR_NOT_CLOSED_BEFORE_EXPIRY`, prêt `RETURN_PENDING` |
| D4 | | Refus incertain du hub (`LOCK_ACTUATION_FAILED`) | `ANOMALY`, une seule anomalie, prêt `RETURN_PENDING` |
| D5 | | Refus sûr du hub (`CLOCK_NOT_SYNCHRONIZED`) | Conclu à l'échéance, pas à la réception : `FAILED COMMAND_REJECTED_CLOCK_NOT_SYNCHRONIZED`, prêt `ACTIVE`, sans anomalie |
| D6 | | Hub perdu après l'accusé du déverrouillage | `ANOMALY DEVICE_OFFLINE_DURING_OPERATION`, prêt `RETURN_PENDING` |
| D7 | | Défi de retour jamais scanné | L'opération se termine ; le prêt n'a jamais quitté `ACTIVE`, aucune commande |
| D8 | | Plafond de 1 préparation, un retrait déjà préparé | Retour `429 LOCAL_PROOF_RATE_LIMITED` avec `Retry-After` : le plafond compte retraits et retours ensemble. L'administrateur est refusé |
| E1 | T2 | Actif remis, porte refermée, puis accusé, portes et scan rejoués | `CONFIRMED` bien avant `expiresAt`, prêt `COMPLETED` avec `returnedAt = confirmedAt`, un seul audit `OPERATION_CONFIRMED` et un seul `LOAN_COMPLETED` |
| E2 | T3, T5 | Porte ouverte et refermée sans l'actif ; le tag réapparaît ensuite dans un scan d'inventaire | `OBSERVATION_RECEIVED`, puis `ANOMALY EXPECTED_ASSET_NOT_OBSERVED` à `expiresAt`. Le scan tardif ne clôt pas le prêt, qui reste `RETURN_PENDING` |
| E3 | | Autre actif lu trois fois à la place de l'actif attendu | `ANOMALY UNEXPECTED_ASSET_OBSERVED` aussitôt, prêt `RETURN_PENDING` |
| E4 | T4 | Règle 2 : lecteur `FAULTED` au scan de fermeture, actif remis | `ANOMALY INCONSISTENT_PHYSICAL_STATE` aussitôt, prêt non clôturé |
| E5 | | Tag attendu lu une seule fois | Aucune preuve ; `ANOMALY` à l'échéance, prêt `RETURN_PENDING` |
| E6 | T5 | Porte refermée 115 s après le déverrouillage ; le scan qui voit l'actif arrive après `expiresAt` | Pas de clôture : `ANOMALY`, prêt `RETURN_PENDING` |

Chaque cas vérifie aussi trois invariants :
- au plus une commande par opération ;
- un seul prêt ;
- un prêt `COMPLETED` seulement par un retour `CONFIRMED`.

**D5 : réglage du moment.** L'horloge du hub doit être désynchronisée après l'affichage du défi, sinon l'écran le
refuse, mais avant le scan. Le scénario marque ce moment en rejouant son propre heartbeat, sans effet sur l'API ; le
script attend cette seconde trace dans le journal du simulateur avant de scanner.

**Projection de la cellule.** Les états de porte et de serrure de la cellule suivent les heartbeats (toutes les 10 s), et
non les événements `LOCK_LOCKED`. Un retour préparé juste après le retrait peut donc voir la serrure encore
`UNLOCKED` et recevoir `409 COMPARTMENT_STATE_UNSAFE`. Le script attend la projection `CLOSED LOCKED` et rapporte le
délai observé.

## Non couvert

- **Prêt d'un autre titulaire (`404`).** Le jeu de démonstration n'a qu'un technicien, comme pour Q10d.
- **Commande jamais publiée.** Elle exige d'arrêter le répartiteur entre le retrait et le retour ; elle reste couverte
  par les tests Backend.
- **Récupération d'un prêt `RETURN_PENDING` (Q2 de doc 09).** Non tranchée : le script vérifie seulement le refus
  actuel.
- **Matériel réel.** Rien de tout cela ne prouve le comportement d'un écran, d'une serrure ou d'un lecteur réels.
