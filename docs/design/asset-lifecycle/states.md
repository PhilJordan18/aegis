# Aegis — Matrice d'états : readiness, réservation, prêt, opération, anomalie

**Mode :** Prototype (aegis-product-design)
**Statut :** proposition non approuvée. Corrigée le 23 septembre 2026
(emprunté jamais « Prêt », pas de consigne d'ouverture à `AUTHORIZED`, codes
bruts hors des libellés principaux); libellés français dans `sections.md` §1.
**Sources normatives :** `docs/cahier-conception/02-scope.md` §9, §10;
`05-machines-a-etats.md` (toutes sections); `09-contrats-rest.md` §8.1–8.7.

Cette matrice ne redéfinit aucun état : elle mappe les états déjà approuvés
dans le domaine vers leur représentation attendue sur iOS et Web. Là où le
contrat ou le scope ne précise rien, la case est marquée **« non défini —
à clarifier »** plutôt que comblée par une invention.

---

## 1. Readiness (`ReadinessAssessment.result`)

| État | Signification (scope §9.1) | iOS (technicien) | Web (administrateur) | Invariant à respecter |
|---|---|---|---|---|
| `READY` | Présent, conforme, disponible, autorisé pour ce demandeur | Badge forme+texte dominant sur la carte actif ; action « Réserver » activée | Pas de readiness administrateur : `AdminAssetView.operationalDiagnostic {evaluatedAt, reasons}` (`09` v1.3 §8.9), raisons non personnelles, sans résultat ni `ACCESS_DENIED` | La readiness n'est **jamais** un champ éditable ; c'est un résultat affiché |
| `BLOCKED` | Au moins une `ReadinessReason` présente | Badge forme+texte + raison principale visible sans clic ; réservation désactivée avec message explicite | Raison(s) visibles dans la table, détail listant toutes les raisons (même réserve que ci-dessus) | Le libellé principal traduit la raison structurée en français clair (« Calibration expirée »), jamais un texte générique seul ; le code brut reste en contexte technique (audit) |
| `UNKNOWN` | État physique indéterminé (ex. lecteur RFID muet) | Badge distinct de `BLOCKED` (ne pas fusionner visuellement) ; réservation désactivée | Idem, avec état « à vérifier » plutôt que « bloqué » pour ne pas induire une conclusion fausse | Ne jamais afficher `UNKNOWN` comme s'il s'agissait de `READY` ou de `BLOCKED` |

`ReadinessReason` (peuvent coexister) : `NOT_PRESENT`, `NOT_AVAILABLE`,
`MAINTENANCE`, `DAMAGED`, `CALIBRATION_EXPIRED`, `ACCESS_DENIED`,
`UNKNOWN_PHYSICAL_STATE`. Chacune doit avoir un gabarit de texte réutilisable
sur les deux plateformes (raison + conséquence + action possible, quand il y
en a une).

## 2. Disponibilité (`AssetView.availability`)

| État | iOS | Web |
|---|---|---|
| `AVAILABLE` | Implicite via readiness/actions activées | Colonne disponibilité + filtre |
| `RESERVED` | Actif visible mais non réservable par un autre technicien ; le titulaire voit sa réservation | Table + lien vers la réservation active |
| `BORROWED` | Idem, avec lien vers le prêt actif si titulaire | Table + lien vers le prêt actif, y compris si `overdue` |
| `UNAVAILABLE` | Actif visible en lecture seule, aucune action de réservation | Table, sans action de réservation |

Un actif `BORROWED`, en retard ou non, ou `RESERVED` par un tiers, n'est
jamais présenté avec le statut principal « Prêt » : sa readiness est
`BLOCKED` (`NOT_AVAILABLE`, `03` §4.13 et `06` §4.4) et le libellé principal
affiche la disponibilité (« Emprunté », « Déjà réservé »). Voir
`sections.md` §1.2.

## 3. État opérationnel (`operationalStatus`) et calibration (`calibration.status`)

| État | iOS | Web |
|---|---|---|
| `SERVICEABLE` / `MAINTENANCE` / `DAMAGED` | Contribue à la readiness ; visible en détail, pas nécessairement en liste | Champ éditable par l'administrateur (formulaire catalogue), lecture seule ailleurs |
| `NOT_REQUIRED` / `VALID` / `EXPIRED` / `UNKNOWN` (calibration) | `EXPIRED` doit apparaître comme raison de blocage avec date d'échéance ; `UNKNOWN` distingué de `NOT_REQUIRED` | Idem + date d'échéance, fuseau `America/Toronto` explicite si affiché |

## 4. Réservation (`ReservationView.status`)

| État | Effet sur l'actif | iOS | Web | Invariant |
|---|---|---|---|---|
| `ACTIVE` | Disponibilité dérivée `RESERVED` | Carte « Ma réservation » avec `reservedUntil` choisi par le technicien dans la plage ouverte, action Annuler | Ligne réservation + lien vers l'actif et le titulaire | Une seule réservation `ACTIVE` par actif **et** par technicien |
| `FULFILLED` | Retrait confirmé, un prêt existe | Disparaît de « réservation active », apparaît comme historique dans le prêt | Historique + lien vers `LockerOperation` de retrait | Terminal — jamais réactivée |
| `CANCELLED` | Redevient disponible après recalcul | Confirmation d'annulation, retour au catalogue | Historique | Terminal |
| `EXPIRED` | Redevient disponible après recalcul | Message explicite « réservation expirée », pas une erreur générique | Historique + audit | Terminal ; ne doit jamais être confondu visuellement avec `CANCELLED` (raisons différentes pour l'administrateur) |

`availableActions[]` du DTO doit piloter les boutons visibles (ne pas
recalculer côté client quelles actions sont permises).

## 5. Prêt (`LoanView.status`) et retard

| État | iOS | Web | Invariant |
|---|---|---|---|
| `ACTIVE` | Carte « Mon prêt » avec `dueAt`, action « Retourner » | Table des prêts actifs, `checkoutOperationId` traçable | L'actif reste `BORROWED` |
| `RETURN_PENDING` | État intermédiaire visible (« retour en cours de confirmation »), pas encore de succès affiché | Idem + statut distinct de `ACTIVE` dans la table | Un retour affiché comme terminé avant confirmation backend est un défaut bloquant |
| `COMPLETED` | Retiré de « Mon prêt », visible en historique | Historique + `returnedAt`, `returnOperationId` | Terminal |
| `overdue = true` (dérivé, pas un état) | Indicateur additionnel sur un prêt `ACTIVE`/`RETURN_PENDING` — jamais présenté comme rendant l'actif disponible | Colonne « en retard » filtrable, sans action de libération forcée | Un prêt en retard **ne libère jamais** l'actif ; ne jamais afficher de bouton « marquer disponible » |

## 6. `LockerOperation` — opération physique (retrait ou retour)

Le scope (§7.6, `SKILL.md` « Physical-operation UX ») impose de représenter la
séquence réelle : demande → autorisation → commande → ouverture → observation
→ confirmation/anomalie. Le mappage ci-dessous regroupe les 11 états du
contrat (`09-contrats-rest.md` §8.5) en phases d'affichage, sans en fusionner
le sens métier.

| État `LockerOperationStatus` | Phase affichée | iOS | Web | Notes |
|---|---|---|---|---|
| `REQUESTED` | Demande envoyée | Écran d'attente court, pas d'action possible | Historique seulement (transitoire) | — |
| `AWAITING_LOCAL_PROOF` | QR affiché sur le hub, en attente de scan | Instruction explicite « Regardez l'écran du hub », compte à rebours du défi (≤ 60 s), bouton scanner | Table/detail: « en attente de preuve locale » | Aucune ouverture n'est possible ici — le texte doit l'exclure explicitement |
| `AUTHORIZED` | Défi validé, fenêtre physique de 120 s démarrée | Compte à rebours 120 s, « Accès autorisé — déverrouillage en préparation. N'ouvrez pas encore. » | Detail: horodatage `authorizedAt`, fenêtre en cours | Exécution encore inconnue : aucune consigne d'ouverture |
| `COMMAND_SENT` | Commande publiée au hub | Étape de progression, « Attendez le signal de la cellule » (pas de consigne d'ouverture) | Detail | — |
| `COMMAND_ACKNOWLEDGED` | Le hub a accepté la commande | Premier état où la consigne d'ouverture est permise (actionnement lancé ou confirmé techniquement, `10` §10.1) ; titre « Déverrouillage lancé », jamais « déverrouillée » ; étape **distincte** de « porte ouverte » | Detail | Le contrat interdit explicitement de la confondre avec une preuve d'ouverture (§9.8) — l'UI doit respecter cette distinction, pas la résumer |
| `DOOR_OPENED` | Porte observée ouverte | Étape de progression, instruction « retirez/déposez l'actif et refermez » | Detail | — |
| `OBSERVATION_RECEIVED` | Preuve physique reçue, en cours d'évaluation | Étape de progression, pas encore de succès affiché | Detail | — |
| `CONFIRMED` | Succès métier | Écran de succès, uniquement ici | Table mise à jour (prêt créé/complété) | Seul état qui autorise un message de succès |
| `FAILED` | Échec sûr, aucun effet métier | Message clair + action « réessayer » si applicable | Historique/anomalie non créée | Ne jamais afficher comme une anomalie |
| `EXPIRED` | Délai dépassé, situation sûre | Message « opération expirée », prêt inchangé | Historique | Distinct de `FAILED` dans le libellé (raison différente pour audit) |
| `ANOMALY` | Réalité physique incertaine | Message « intervention requise », pas de bouton de nouvelle tentative directe sans passer par le support | Écran d'anomalie avec lien `anomalyId`, preuves | Jamais présenté comme un simple échec réseau |

`requiredAction` (`SCAN_HUB_QR`, `WAIT`, `NONE`) doit piloter l'affichage
iOS — ne pas dériver cette décision côté client.

## 7. Défi local (`LocalAccessChallenge`)

| État | iOS | Web |
|---|---|---|
| `PENDING` | Compte à rebours actif, bouton scanner disponible | Non exposé directement (détail technique du hub) — **non défini : faut-il un indicateur de session hub côté Web ? à clarifier avec `solution-architect`** |
| `CONSUMED` | Transition immédiate vers `AUTHORIZED` de l'opération | — |
| `EXPIRED` | Message « QR expiré, relancez la préparation » | Trace en audit |
| `INVALIDATED` | Message « accès annulé » (ex. 5 essais erronés, redémarrage) | Trace en audit |

## 8. Anomalie (`AnomalyView.status`)

| État | Action humaine permise | iOS | Web |
|---|---|---|---|
| `OPEN` | Consulter, investiguer, commencer la correction | Écran d'anomalie bloquant si elle concerne l'opération en cours du technicien | Liste priorisée par sévérité (`LOW`/`MEDIUM`/`HIGH`), badge non ignorable |
| `ACKNOWLEDGED` | Corriger physiquement (note unique saisie à la reconnaissance : `09` §18 n'offre pas d'ajout ultérieur, voir `sections.md` C5) | — (concerne surtout l'administrateur) | Formulaire d'accusé avec note obligatoire, **pas** de bouton « résoudre » |
| `RESOLVED` | Consultation seule | — | Historique avec `resolutionEvidenceObservationId` traçable |

**Invariant non négociable :** aucune UI, ni Web ni iOS, ne propose de bouton
qui fait passer une anomalie à `RESOLVED` manuellement. Seule une preuve
physique cohérente validée par le backend la résout (§6.4 de
`05-machines-a-etats.md`).

## 9. Statut du locker et des compartiments (`LockerStatusView`)

| Élément | Valeurs | iOS | Web |
|---|---|---|---|
| `connectionStatus` (locker) | `ONLINE`, `OFFLINE`, `UNKNOWN` | Bloque le scan avec message explicite si `OFFLINE`/`UNKNOWN` avant de lancer une préparation | Bandeau d'état persistant, jamais uniquement une icône colorée |
| `doorState` / `lockState` (par compartiment) | selon device | Non exposé en détail au technicien (au-delà de l'instruction en cours) | Table des compartiments avec dernier `lastObservedAt` |
| `rfidReaderStatus` | selon device | Non exposé | Table des compartiments |

**Non défini — à clarifier :** le contrat ne précise pas explicitement
comment le mobile doit réagir si le locker passe `OFFLINE` *pendant* une
opération déjà `AUTHORIZED` (la fenêtre physique de 120 s continue-t-elle
d'apparaître comme active à l'écran ?). Le domaine traite ce cas côté backend
(`ANOMALY` probable, §5.4) mais le comportement d'affichage correspondant
n'est pas spécifié — à confirmer avec `solution-architect`/`backend-security-engineer`
avant la haute fidélité.

## 10. États d'interface transverses (obligatoires par écran important)

Ces états ne sont pas des états de domaine mais sont exigés par `SKILL.md`
(« Required UI states ») pour tout écran significatif. Ils s'appliquent au
catalogue, au détail d'actif, à l'opération physique, au tableau de bord et à
la table des actifs/anomalies :

| État transverse | iOS | Web |
|---|---|---|
| Chargement | Squelette ou indicateur natif, jamais un écran vide silencieux | Squelette de ligne/carte |
| Vide (premier usage) | « Aucun actif accessible avec vos droits actuels » — jamais confondu avec une erreur | « Aucun résultat pour ces filtres » avec action pour réinitialiser |
| Succès | Voir §6 (`CONFIRMED` uniquement) | Confirmation inline, pas de redirection qui masque le contexte |
| Erreur de validation | Associée au champ concerné (ex. `reservedUntil` hors plage) | Idem, focus clavier déplacé vers le champ |
| Erreur serveur | Message générique + action réessayer, sans exposer de détail technique | Idem + code de corrélation pour le support |
| Non autorisé | Redirection connexion ou message de droits insuffisants, jamais un écran vide | Idem |
| Opération expirée | Voir §6 `EXPIRED` | Voir §6 |
| Opération physique en cours | Voir §6, jamais de succès anticipé | Voir §6 |
| Anomalie | Voir §8 | Voir §8 |
| Périmé/déconnecté | Locker `OFFLINE`/`UNKNOWN` — voir §9 | Bandeau global + horodatage `lastSeenAt` |

---

## 11. Écarts et zones à clarifier avant la haute fidélité

- Comportement d'affichage exact si le locker devient `OFFLINE` pendant une
  fenêtre physique déjà autorisée (§9 ci-dessus).
- Aucun gabarit de copie officiel n'existe pour les `ReadinessReason` et les
  `failureReason`/résumés d'anomalie : la version finale des textes français
  (au-delà des exemples illustratifs de ce document) reste à valider avec
  l'équipe produit avant le gate C (haute fidélité).
- Le contrat ne définit pas de notion de site/atelier multi-locker — toute
  maquette qui en suggère un (comme l'artefact existant) doit être corrigée à
  la source, pas seulement dans le libellé.
