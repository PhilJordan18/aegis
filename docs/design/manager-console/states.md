# Console Manager : matrice des états

Mode : Prototype. Issue #158 (DES-02). Statut : **proposition à valider par Philippe**.
Chaque état est un paramètre `state` de la page du prototype (`prototype/<écran>.html?state=…`). Aucune approbation n'est acquise.

Sources : `09-contrats-rest.md` §7, §8.3 à §8.8, §16, §17, §18, §19, §21, §22; `03-dictionnaire-de-donnees.md` §4.19, §5.11;
`docs/design/asset-lifecycle/sections.md` §5.1, §5.3, §5.5, §5.6, §7.1. Les repères **G1 à G13** renvoient aux décisions de `handoff.md` §7.

## 1. Règles communes à tous les écrans

| Situation | Déclencheur API | Traitement |
|---|---|---|
| Chargement | Requête de liste en cours | Lignes squelettes statiques, `aria-busy`, annonce « Chargement… ». Aucun compteur, aucune date de mise à jour. |
| Vide par filtre | `200` avec `items: []` et au moins un filtre actif | Titre « Aucun … ne correspond à ces filtres. » + « Tout afficher ». Ne dit jamais « aucun enregistrement » sans filtre. |
| Erreur partielle | Une lecture sur plusieurs échoue (module, détail, page suivante) | Le bloc concerné porte l'alerte; le reste reste lisible. Aucune valeur n'est complétée à la place de la lecture manquante. |
| Périmé | Actualisation en échec, données déjà affichées | Alerte « Données non actualisées. » avec l'heure de lecture; les données restent affichées, datées de leur lecture. |
| Session terminée | `401` (`AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`) §21 | L'application revient à la connexion « Session expirée » (`manager-v3/prototype/sign-in.html?state=session-expired`). L'écran ne montre aucune donnée. |
| Accès refusé | `403 FORBIDDEN` §21 | Alerte d'erreur « Votre compte n'a pas accès à … ». Aucune donnée chargée, aucune relance. |
| Dossier introuvable | `404 RESOURCE_NOT_FOUND` sur une **ressource par identifiant** (§17, §18.1) | Alerte « Dossier introuvable. » dans le dossier + « Retour à la liste ». La liste reste utilisable. |
| Injoignable | Réseau coupé, délai dépassé, `5xx` sans corps | Alerte d'avertissement, sans identifiant de suivi, « Réessayer ». |
| Erreur du service | `5xx` avec `problem+json`; **et `404 RESOURCE_NOT_FOUND` sur une route de liste** (§21) | Alerte d'erreur, `traceId` affiché tel quel et sélectionnable, « Réessayer ». Un `404` de liste ne prouve ni que la route n'est pas servie, ni que la liste est vide : aucun état « pas encore disponible » n'en est déduit, et l'écran n'affiche jamais zéro ni « vide ». |
| Valeur inconnue d'une énumération | Valeur hors du catalogue de cette version (§3) | « Type non reconnu par cette version » ou « Événement non reconnu · CODE »; jamais traité comme un état connu. |

« Réessayer » et « Actualiser » sont simulés dans le prototype (700 ms, puis retour à l'état nominal).

## 2. Vue d'ensemble (`overview.html`)

Lectures : anomalies `status=OPEN` (§18.1), prêts `ACTIVE` puis `RETURN_PENDING` avec `overdue` du serveur (§17, §8.4), réservations `ACTIVE` (§17),
`GET /admin/lockers` (§16.2) et `GET /lockers/{id}/status` (§16.1), opérations non terminales dérivées de `currentOperationId` (G7).
Aucun graphique, aucun total calculé sur une page, aucune readiness côté client, aucune action corrective.

| `state` | Ce que l'écran montre | Déclencheur | Réf. |
|---|---|---|---|
| `nominal` | Cinq modules : anomalies (gravité, cellule, détection), prêts en retard, casier, opération en cours, réservations actives | `200` partout | §18.1, §17, §16 |
| `loading` | Cinq modules squelettes | requêtes en cours | |
| `all-clear` | « Aucune anomalie ouverte. » et « Aucun prêt en retard. » dans les modules; le casier garde sa ligne | `items: []` pour `OPEN` et aucun `overdue=true` | §18.1, §8.4 |
| `locker-offline` | Bandeau persistant « Casier AEGIS-DEMO-01 hors ligne. Dernier signal : 14 h 11. »; cellules marquées « dernier état connu » | `connectionStatus = OFFLINE` | §16.1, §8.6 |
| `locker-unknown` | Bandeau « état inconnu : aucune présence ni absence supposée »; valeurs des cellules « Inconnue » | `connectionStatus = UNKNOWN` | §16.1, 10 §15.3 |
| `partial` | Prêts : « Au moins 1 en retard » + « Lecture incomplète » (la lecture `RETURN_PENDING` a échoué); casier : injoignable; réservations : erreur du service avec `traceId`; anomalies et opération lisibles | `RETURN_PENDING` en erreur, `/lockers/{id}/status` réseau, `/admin/reservations` `5xx` | §17, §7.1 |
| `stale` | Données du dernier chargement + alerte « Données non actualisées. » avec l'heure | actualisation en échec | |
| `unreachable`, `service-error` | Une seule alerte (quand **toutes** les lectures échouent de la même façon; sinon alerte par module, voir `partial`). `service-error` : identifiant de suivi + « Réessayer », jamais de zéro | réseau; `5xx` ou `404` de liste | §21 |
| `forbidden` | Alerte « Votre compte n'a pas accès à la vue d'ensemble. » | `403` | §21 |
| `unauthorized` | Rien (renvoi à la connexion) | `401` | §21 |

## 3. Réservations et prêts (`reservations.html?tab=reservations|loans|operations`)

Lecture seule : `GET /admin/reservations`, `/admin/loans`, `/admin/locker-operations` et leurs détails (§17). Filtres : `status` (une valeur), `assetId`, `from`, `to`, `page`, `size`.
Aucune fin de prêt, confirmation, retour forcé ni ouverture à distance (§17, §25). `availableActions` n'est jamais affiché (G11).

| `state` | Ce que l'écran montre | Déclencheur | Réf. |
|---|---|---|---|
| `nominal` | Liste (statut en tête) et dossier. Prêt en retard : « Retour en cours » + « En retard » et « l'équipement reste emprunté » | `200` | §8.3, §8.4, §8.5 |
| `loading` | Liste et dossier squelettes | | |
| `empty` | Filtres préréglés sans résultat (par onglet) : « Aucun résultat pour ces filtres. » | `items: []` avec filtre | §17 |
| `partial` | Liste et dossier lisibles; la section « Opérations liées » porte une alerte d'erreur (lecture de l'opération liée, §17) | `GET /admin/locker-operations/{id}` `5xx` | §17 |
| `stale` | Alerte « Données non actualisées. » en tête de liste | | |
| `unreachable`, `service-error`, `forbidden`, `unauthorized` | Alerte dans la liste (pas de dossier), `401` : renvoi | réseau, `5xx` ou `404` de liste, `403`, `401` | §21 |
| `detail-404` | Liste lisible, dossier « Dossier introuvable. » | `404` sur `/{id}` | §21 |
| `join-failed` (onglet Opérations) | Équipement et cellule en « identifiant seulement » + alerte « Libellés non résolus » | échec de la jointure Équipements / Casiers (G3) | §8.5, §12.2, §16.2 |

Particularités d'affichage (toutes les langues) :

- **Titulaire** : « Titulaire : identifiant seulement » + UUID; aucun nom inventé (G1).
- **Retard** : booléen `overdue` du serveur; texte « En retard depuis 12 h 30 » (heure de `dueAt`, pas une durée calculée par l'horloge du client). Un prêt `COMPLETED` n'est jamais en retard.
- **Réservation → prêt** : « Non fourni par la réservation. Aucun prêt n'est déduit d'une réservation. » + lien vers les opérations de l'équipement (G8).
- **Opération** : chaque étape n'affiche que l'instant transmis; une étape sans instant est « Non reçue » (opération terminale) ou « Pas encore reçue » (non terminale); `acknowledgedAt` s'intitule « Commande acquittée par la cellule » et ne dit jamais « déverrouillée » (U4).
- **Pagination** : `size` et `page` dans l'URL (`?size=2` montre le pager); « Précédent » et « Suivant » comme `AssetList`.

## 4. Anomalies (`anomalies.html`)

Lectures : `GET /admin/anomalies`, `/{id}` (§18.1). Écriture unique : `POST …/acknowledge` avec `Idempotency-Key` (§18.2). Aucun bouton « Résoudre » (§25).
Rappel permanent en tête d'écran : « Une anomalie se résout seulement lorsqu'une nouvelle observation du casier le confirme. »

| `state` | Ce que l'écran montre | Déclencheur | Réf. |
|---|---|---|---|
| `nominal` | Filtre par défaut « Ouvertes »; liste (gravité, statut, type, cellule, détection) et dossier avec « Reconnaître » | `200` | §8.7 |
| `loading`, `empty`, `stale`, `unreachable`, `service-error`, `forbidden`, `unauthorized`, `detail-404` | Comme § 1; `empty` : filtre « Ouvertes » + gravité « Faible » sans résultat | | §21 |
| `partial` | Liste et champs du dossier lisibles; la section « Preuves » porte une alerte « Le détail (preuves) n'a pas pu être chargé » | `GET /admin/anomalies/{id}` `5xx` | §18.1 |
| `join-failed` | « Équipement : identifiant seulement », « Cellule : identifiant seulement » + alerte | jointure en échec (G3) | §8.7 |
| `ack-resolved` | Dialogue : « Cette anomalie est déjà résolue. Aucune reconnaissance n'a été enregistrée. » + « Actualiser et fermer »; le dossier passe en « Résolue » avec bandeau d'information | `409 ANOMALY_ALREADY_RESOLVED` | §18.2, §21 |
| `ack-not-acknowledgeable` | Dialogue : « Cette anomalie ne peut pas être reconnue dans son état actuel. » + « Actualiser et fermer » | `409 ANOMALY_NOT_ACKNOWLEDGEABLE` | §18.2 |
| `ack-validation` | Erreur sous le champ « Note » (association `aria-describedby`, `aria-invalid`) | `400 VALIDATION_ERROR`, violation `note` | §18.2, §7.1 |
| `ack-unreachable` | Dialogue : « La reconnaissance n'a pas été confirmée. » + « Réessayer est sans risque » (même `Idempotency-Key`) | réseau | §20 |

Dialogue de reconnaissance (`?dialog=1`) : note obligatoire de **1 à 500 caractères** (comptés en graphèmes, G9); note vide ou d'espaces : « Saisissez une note de reconnaissance. »;
trop longue : « La note compte au plus 500 caractères. ». Le texte du dialogue répète que l'anomalie **n'est pas résolue**.
Succès nominal : `200` avec `AnomalyView` au statut `ACKNOWLEDGED`; l'anomalie reste visible, le statut passe à « Reconnue », le nom de l'administrateur et la note s'affichent, annonce « Anomalie reconnue. Elle n'est pas résolue. ».
Une anomalie `ACKNOWLEDGED` n'offre plus « Reconnaître »; le serveur reste l'arbitre (`409`).

## 5. Audit (`audit.html`)

Lecture : `GET /admin/audit-events` avec curseur opaque (§19.1, §22.2). Aucune action d'écriture. « Historique non modifiable » en tête.

| `state` | Ce que l'écran montre | Déclencheur | Réf. |
|---|---|---|---|
| `nominal` | Chronologie par jour (heure à la seconde, événement, acteur, sujet, de → vers) + détail à codes; « Charger la suite » charge la page suivante, « Fin de l'historique pour ces filtres. » à la fin | `200`, `hasMore` | §19.1 |
| `loading`, `stale`, `unreachable`, `service-error`, `forbidden`, `unauthorized` | Comme § 1 | | §21 |
| `empty` | Filtre `eventType` préréglé sans résultat + puce de filtre active | `items: []` | §19.1 |
| `partial` | Page 1 lisible; sous la liste « La suite n'a pas pu être chargée » + `traceId` + « Réessayer » | page suivante `5xx` | §19.1 |
| `invalid-cursor` | Page 1 lisible; sous la liste « La liste a changé. Recommencez depuis le début. » + « Recommencer » | `400 INVALID_CURSOR` | §22.2, §21 |

Particularités : le nombre affiché est « N événements chargés », jamais un total; « D'autres événements existent. » tant que `hasMore`.
Les codes (`eventType`, états, `result`, `reason`, clés de `details`) ne sont visibles que dans le détail. L'absence de preuve est dite : « Aucune preuve physique n'est référencée par cet événement. »
Aucun événement physique n'est synthétisé : le prototype ne comble aucun trou entre deux événements.

## 6. Couverture par thème, langue et taille

Chaque état est rendu en FR et EN, sombre et clair; l'accessibilité est mesurée par `verify/axe.mjs` à 1440 et 390 px (voir `README.md` pour les comptes).
