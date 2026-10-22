# Aegis Mobile — parcours du technicien après la connexion

Mode : Prototype. Date : 21 octobre 2026. Issue : #35 (DES-01). Suite de
`../mobile-entree/` (connexion, approuvée et intégrée par #36).

**Statut : proposition à valider.** Ce dossier rassemble, pour validation, les
parcours restants de #35 : catalogue, fiche équipement, réservation,
préparation du retrait et scan du code du casier, progression physique, prêt
actif et retour. Il ne déclare rien approuvé de nouveau.

| Élément | Statut |
|---|---|
| Structure des sections, hiérarchies, règles d'affichage et textes français de `../asset-lifecycle/sections.md` §1, §4, §6, décisions U1 à U8 | **Approuvé** le 23 septembre 2026; repris tel quel |
| Direction « Lumière du hub » v3, logo provisoire, apparences claire et sombre, connexion | **Approuvé** le 21 octobre 2026 (`../mobile-entree/proposition.md`) |
| Transposition de la v3 aux écrans intérieurs, composants, couleurs de statut sur les surfaces v3, matrice d'états complétée, textes anglais, comportements d'accessibilité | **Proposition** (ce dossier) |

Les rendus de `captures/` viennent d'un prototype SwiftUI statique (`prototype/`),
compilé dans une copie temporaire de `apps/ios` : données fictives, aucune
requête, aucune caméra. Aucun écran métier n'est câblé dans l'application :
l'API de `dev` n'expose aujourd'hui que la connexion, le profil et la santé.

## 1. Règles qui s'appliquent à tous les parcours

- **Autorité du backend.** L'application affiche l'état reçu
  (`LockerOperationView.status`, `requiredAction`, `availableActions`) et ne
  le déduit jamais. Ni un QR, ni une animation, ni un compte à rebours ne
  prouvent une ouverture, un retrait ou un retour. Seul `CONFIRMED` affiche un
  succès.
- **Jamais « Prêt » pour un actif emprunté** et jamais de consigne d'ouverture
  avant `COMMAND_ACKNOWLEDGED` (`sections.md` §1.2, §1.4).
- **Codes bruts** hors des libellés : seuls le texte, le symbole et la forme
  portent l'état; le `traceId` s'affiche après « Identifiant de suivi ».
- **Heure du casier.** Les heures métier (`reservedUntil`, `dueAt`,
  fermeture) sont formatées dans le fuseau du casier
  (`currentWindow.timeZone`), jamais dans celui de l'appareil.
- **Statut toujours triple** : symbole, forme de pastille et texte; jamais la
  couleur seule.
- **Erreurs** : une phrase courte, issue du code; le `detail` du serveur n'est
  jamais affiché. Un 401 renvoie à la connexion (session expirée ou invalide,
  #36); un 403 refuse l'action sur place sans fermer la session.
- **Idempotence** : une nouvelle tentative de la même intention réutilise sa
  clé (`Idempotency-Key`); un double appui est ignoré pendant l'envoi.

## 2. Système visuel des écrans intérieurs (proposition)

| Élément | Proposition |
|---|---|
| Navigation | `TabView` natif à trois onglets approuvé : Équipements (`shippingbox`), Mon activité (`checklist`), Compte (`person.crop.circle`); grands titres natifs |
| Fond | `BrandTop` (clair `#EDF2FA`, sombre `#070D17`), sans halo derrière les listes |
| Cartes | `BrandPanel` (`#FFFFFF` / `#0D1520`), coins continus de 20 pt, filet `BrandBorder` |
| Pastille de statut | Capsule : symbole SF + texte, couleurs `ready`, `blocked`, `unknown`, `mine`, `progress`, `neutral` du prototype (`../asset-lifecycle/prototype/tokens/brand.css`), en clair et en sombre |
| Bouton principal | Bouton v3 de la connexion (54 pt, coins de 14 pt, accent `AccentColor`) |
| Opération guidée | Plein écran (`fullScreenCover`) : cellule en très grand (« A1 »), titre d'étape, consigne unique, liste des étapes, compte à rebours en chiffres tabulaires |
| Mouvement | Transitions natives courtes; aucune animation de porte ou de déverrouillage; Réduire les animations supprime les transitions décoratives |

Contrastes des pastilles (texte sur fond de pastille, WCAG), clair puis
sombre : `ready` 5,7 et 9,2; `blocked` 6,6 et 8,5; `unknown` 6,6 et 10,2;
`mine` 8,3 et 8,5; `progress` 6,5 et 8,1; `neutral` 8,0 et 9,7. Détail dans
§9.

## 3. Catalogue (onglet Équipements)

**Objectif** (approuvé) : trouver un équipement et savoir immédiatement s'il
est prêt **pour moi**, sinon pourquoi.

**Composition** : recherche native (`searchable`, « Code ou modèle ») →
filtres (Tous · Prêt · Bloqué · À vérifier) → cartes : pastille de statut,
puis modèle et code, puis raison principale ou cellule → pied « État évalué à
14 h 30, heure du casier. » Tirer pour actualiser.

| État | Déclencheur | Affichage | Accessibilité |
|---|---|---|---|
| Chargement | Première lecture `GET /assets` | Cartes squelettes natives (`redacted`) | « Chargement des équipements » annoncé une fois |
| Liste | 200 | Cartes; statut selon `sections.md` §1.2 | Chaque carte est un seul élément : « Prêt, Multimètre 1, MM-001, disponible dans la cellule A1 » |
| Aucun résultat | 200, liste vide avec recherche ou filtre | « Aucun équipement ne correspond. » + **Effacer les filtres** | Annonce du résultat |
| Catalogue vide | 200, liste vide sans filtre | « Aucun équipement n'est encore disponible. » | — |
| Hors ligne | Erreur réseau | Bandeau « Connexion au service impossible. Vérifiez le réseau. » + **Réessayer**; la dernière liste reste visible, marquée « Informations non actualisées » | Annonce du bandeau |
| Erreur du service | 5xx | « Le service n'a pas pu charger les équipements. » + Identifiant de suivi | — |
| Session | 401 | Retour à la connexion (#36) | — |

## 4. Fiche équipement

**Composition** (approuvée) : statut et identité (modèle, code, fabricant) →
toutes les raisons, la principale en premier avec sa suite actionnable
(`sections.md` §1.3) → calibration (échéance, heure du casier) → niveau
d'accès requis → cellule → **Réserver**, actif seulement si
`readiness.result = READY`, sinon désactivé avec la raison sous le bouton.

| État | Déclencheur | Affichage |
|---|---|---|
| Prêt | `READY` | Pastille Prêt; Réserver actif |
| Réservé pour vous | Réservation active du technicien sur cet actif | Pastille « Réservé pour vous » (`mine`); bouton **Voir mon activité** |
| Bloqué | `BLOCKED` | Pastille Bloqué; liste des raisons; Réserver désactivé : « Réservation impossible : calibration expirée. » |
| Emprunté / Déjà réservé | `NOT_AVAILABLE` | Libellés de §1.2; aucun détail sur un autre titulaire |
| Accès insuffisant | `ACCESS_DENIED` | « Niveau d'accès insuffisant » + « Demandez l'accès à un administrateur. » |
| À vérifier | `UNKNOWN` | Pastille À vérifier (`unknown`, losange) : « Présence non confirmée par le casier. » |
| Introuvable | 404 | « Cet équipement n'est plus disponible. » + retour à la liste |
| Hors ligne | Erreur réseau | Dernière fiche affichée, marquée « Informations non actualisées »; Réserver désactivé tant que la fiche n'est pas relue |

Le bouton reste une affordance : le serveur revalide tout au moment de la
réservation.

## 5. Réservation (feuille)

**Composition** (approuvée) : équipement et cellule → heure de retour
(`reservedUntil`, sélecteur natif, pas de 15 min) bornée par
`currentWindow.closesAt` → rappel « Retirez l'équipement avant cette heure;
la réservation n'ouvre aucune porte. » → **Confirmer la réservation**.

| État | Déclencheur | Affichage |
|---|---|---|
| Chargement de la plage | `GET /lockers/{id}/status` | Sélecteur désactivé, indicateur |
| Casier fermé | `currentWindow.open = false` | « Le casier est fermé. Réouverture à 7 h 00. » (ou « Aucun horaire d'ouverture. »); confirmation désactivée |
| Casier hors ligne | `connectionStatus = OFFLINE` | Avertissement « Le casier est hors ligne. Le retrait pourrait être impossible. »; la réservation reste possible si le serveur l'accepte |
| Envoi | `POST /reservations` en cours | Bouton « Réservation… »; feuille non fermable |
| Créée | 201 | Feuille fermée, **Mon activité** ouverte sur la réservation; annonce « Réservation confirmée jusqu'à 16 h 30 » |
| Refus | `403 ASSET_ACCESS_DENIED`, `409 ASSET_ALREADY_RESERVED`, `409 USER_ALREADY_HAS_ACTIVE_RESERVATION`, `409 ASSET_HAS_OPEN_LOAN`, `422 ASSET_NOT_READY`, `422 OUTSIDE_OPERATING_HOURS`, `422 RESERVATION_END_AFTER_CLOSING` | Messages approuvés de `sections.md` §4.1 dans la feuille; la fiche est relue |
| Réseau | Erreur réseau | « Connexion au service impossible. » + **Réessayer** avec la même clé d'idempotence |

## 6. Mon activité

**Composition** (approuvée) : une carte d'état unique — équipement et état
dans la même zone → cellule → échéance → action principale. Pas d'historique
en P0.

| État | Source | Carte | Action principale | Secondaire |
|---|---|---|---|---|
| Aucune activité | 404 sur `/me/reservation` et `/me/loan` | « Aucune réservation ni prêt en cours. » | **Voir les équipements** | — |
| Réservation active | `ReservationView.ACTIVE` | « Réservé pour vous » · « À retirer avant 16 h 30 » | **Préparer le retrait** | Annuler la réservation (confirmation approuvée) |
| Réservation expirée | `EXPIRED` | « Votre réservation a expiré à 16 h 30. » | **Voir les équipements** | — |
| Opération en cours | `currentOperationId` non terminal | « Retrait en cours » / « Retour en cours » | **Reprendre** (relit l'opération, ne redéclenche rien) | — |
| Prêt actif | `LoanView.ACTIVE` | « Emprunté par vous » · « Retour prévu à 16 h 30 » | **Retourner l'équipement** | Voir l'équipement |
| Prêt en retard | `overdue = true` | « Emprunté par vous » · « En retard depuis 16 h 30 — rapportez l'équipement. » | **Retourner l'équipement** | — |
| Retour en attente | `RETURN_PENDING` | « Retour en attente de vérification. » | **Reprendre** si une opération est en cours; sinon selon `availableActions` | — |
| Chargement / hors ligne | — | Carte squelette / bandeau réseau, dernière carte marquée non actualisée | — | — |

Les boutons suivent `availableActions`; l'application ne recalcule pas les
actions permises.

## 7. Retrait et retour guidés

### 7.1 Préparation

**Préparer le retrait** (`POST /reservations/{id}/checkout`) ou **Retourner
l'équipement** (`POST /loans/{id}/return`) ouvre l'opération guidée. La
réponse `202` ne crée aucune commande de serrure.

| Refus à la préparation | Message |
|---|---|
| `409 LOCKER_OPERATION_IN_PROGRESS` | « Le casier est occupé par une autre opération. Réessayez dans un instant. » |
| `503 LOCKER_OFFLINE` | « Le casier est hors ligne. Réessayez plus tard. » |
| `503 DEVICE_UNAVAILABLE` | « La cellule A1 est indisponible. Prévenez un administrateur. » |
| `409 COMPARTMENT_STATE_UNSAFE` | « La cellule A1 n'est pas dans un état sûr. Prévenez un administrateur. » |
| `422 PHYSICAL_STATE_UNKNOWN` | « La présence de l'équipement n'est pas confirmée. Réessayez plus tard. » |
| `422 OUTSIDE_OPERATING_HOURS` | « Le casier est fermé. » |
| `409 RESERVATION_NOT_CANCELLABLE`, `409 LOAN_NOT_RETURNABLE` | « Cette action n'est plus possible. » puis relecture de Mon activité |

### 7.2 Code du casier (feuille de scan)

Ouverte seulement quand `requiredAction = SCAN_HUB_QR` (`sections.md` §6).

| État | Affichage |
|---|---|
| Code pas encore affiché | `localProofDisplayedAt` nul : « Le code s'affiche sur l'écran du casier… », scan désactivé |
| Autorisation caméra à demander | Explication avant la demande système : « L'appareil photo sert uniquement à lire le code du casier. » |
| Caméra refusée ou restreinte | « Autorisez l'appareil photo dans Réglages pour scanner le code. » + **Ouvrir Réglages**; aucun contournement |
| Caméra indisponible | « Aucun appareil photo n'est disponible sur cet appareil. » |
| Scan | Aperçu caméra, cadre, échéance « Expire dans 0:47 », rappel « Aucune porte n'est ouverte. » |
| Code reconnu | Retour haptique léger + annonce « Code lu »; envoi `authorize-local`; « Vérification du code… » |
| Code étranger | « Ce code n'est pas un code Aegis. » |
| Refus serveur | Messages de §6 : autre opération, code refusé, pas encore affiché, expiré, déjà utilisé, invalidé, trop d'essais (délai `Retry-After` affiché une seule fois) |
| Réseau | « Connexion au service impossible. » + **Réessayer** avec la même clé |

Le secret lu n'est jamais conservé ni journalisé; après un refus, un nouveau
scan est nécessaire.

### 7.3 Progression physique

États et textes approuvés de `sections.md` §1.4, sans exception :
`REQUESTED`, `AWAITING_LOCAL_PROOF` (avant et après affichage),
`AUTHORIZED` (« N'ouvrez pas encore. »), `COMMAND_SENT`,
`COMMAND_ACKNOWLEDGED` (« Déverrouillage lancé », première consigne
d'ouverture), `DOOR_OPENED`, `OBSERVATION_RECEIVED`, `CONFIRMED` (seul
succès), `FAILED`, `EXPIRED`, `ANOMALY`.

**Proposition d'écran** : cellule en très grand → titre de l'étape → consigne
unique → compte à rebours de 120 s dès `AUTHORIZED` (depuis `expiresAt`) →
liste verticale des six phases (Demande, Code du casier, Autorisation,
Commande, Porte, Vérification) avec l'étape courante mise en évidence.

| Attente ou échec matériel | Affichage |
|---|---|
| Réseau perdu pendant le suivi | Bandeau « Connexion perdue. L'opération continue sur le casier; la progression reprendra dès le retour du réseau. »; dernière étape connue figée, jamais présentée comme terminée; suivi ralenti puis repris (`09` §15.4) |
| Application en arrière-plan | Suivi suspendu; relecture immédiate au retour |
| Porte restée fermée | `EXPIRED` : « Délai dépassé. Aucune porte n'a été ouverte. Recommencez la préparation. » |
| Échec sûr | `FAILED` : « Opération arrêtée sans ouverture. Vous pouvez recommencer. »; motif générique tant que `failureReason` reste une chaîne libre (C8) |
| Incertitude physique | `ANOMALY` : « Intervention requise. Ne réessayez pas. Un administrateur doit vérifier la cellule A1. » |
| Session expirée en cours | Retour à la connexion, avec l'information que l'opération du casier n'est pas annulée; reprise par `currentOperationId` après connexion |

**Fermer** masque l'opération guidée sans l'annuler : l'opération continue
côté serveur et Mon activité propose **Reprendre**. Aucun bouton ne termine
ou ne confirme une opération.

**Retour** : mêmes étapes, consigne « déposez »; après `CONFIRMED`, « Retour
confirmé » puis Mon activité vide.

**Accessibilité** : chaque changement d'étape est annoncé une fois (titre et
consigne); le compte à rebours n'est pas annoncé chaque seconde, seulement à
30 s et 10 s; il est lisible comme valeur (« 1 minute 47 secondes
restantes »); retours haptiques en appui seulement; aucune information portée
par la seule couleur ou le seul mouvement.

## 8. Textes (français de référence, anglais proposé)

Les textes français marqués « approuvé » viennent de `sections.md`; leurs
traductions et les autres textes sont **proposés**.

| Clé | Français | English | Statut FR |
|---|---|---|---|
| Onglets | Équipements · Mon activité · Compte | Equipment · My activity · Account | approuvé |
| Recherche | Code ou modèle | Code or model | proposé |
| Filtres | Tous · Prêt · Bloqué · À vérifier | All · Ready · Blocked · Needs checking | approuvé |
| Pied de liste | État évalué à 14 h 30, heure du casier. | Status checked at 2:30 p.m., locker time. | proposé |
| Vide | Aucun équipement ne correspond. | No equipment matches. | approuvé |
| Non actualisé | Informations non actualisées | Information not refreshed | approuvé |
| Cellule | Disponible dans la cellule A1 | Available in compartment A1 | approuvé |
| Réserver | Réserver · Confirmer la réservation | Reserve · Confirm reservation | approuvé |
| Rappel | Retirez l'équipement avant cette heure; la réservation n'ouvre aucune porte. | Pick up the equipment before this time; the reservation opens no door. | approuvé |
| Statuts | Prêt · Réservé pour vous · Déjà réservé · Emprunté par vous · Emprunté · Indisponible · Bloqué · À vérifier | Ready · Reserved for you · Already reserved · Borrowed by you · Borrowed · Unavailable · Blocked · Needs checking | approuvé |
| Actions | Préparer le retrait · Retourner l'équipement · Reprendre · Annuler la réservation | Prepare checkout · Return equipment · Resume · Cancel reservation | approuvé |
| Aucune activité | Aucune réservation ni prêt en cours. | No reservation or loan in progress. | approuvé |
| Retard | En retard depuis 16 h 30 — rapportez l'équipement. | Overdue since 4:30 p.m. — bring the equipment back. | approuvé |
| Scan | Scannez le code affiché sur le casier · Aucune porte n'est ouverte. | Scan the code shown on the locker · No door is open. | approuvé |
| Autorisé | Accès autorisé · N'ouvrez pas encore. | Access authorized · Don't open yet. | approuvé |
| Déverrouillage | Déverrouillage lancé · Ouvrez la porte A1 et retirez le multimètre. | Unlock started · Open door A1 and take the multimeter. | approuvé |
| Succès | Retrait confirmé · Retour confirmé | Checkout confirmed · Return confirmed | approuvé |
| Réseau perdu | Connexion perdue. L'opération continue sur le casier; la progression reprendra dès le retour du réseau. | Connection lost. The operation continues at the locker; progress resumes when the network is back. | proposé |

Les autres messages de refus reprennent `sections.md` §4.1, §4.2 et §6; leur
version anglaise suivra le glossaire partagé (`docs/localisation/`).

## 9. Contrastes des pastilles de statut

Texte de la pastille sur son fond (valeurs du prototype `brand.css`) :

| Statut | Clair (texte / fond) | Ratio | Sombre (texte / fond) | Ratio | Symbole / fond (clair, sombre) |
|---|---|---:|---|---:|---|
| `ready` | `#0B6B3F` / `#E1F4EA` | 5,7 | `#6FE3A8` / `#0E2E2A` | 9,2 | 4,2 · 7,7 |
| `blocked` | `#A3161A` / `#FCE7E6` | 6,6 | `#FFA59E` / `#3A1424` | 8,5 | 4,7 · 6,3 |
| `unknown` | `#7A4B00` / `#FFF0D1` | 6,6 | `#FFD27A` / `#33280F` | 10,2 | 4,2 · 9,0 |
| `mine` | `#3726B8` / `#ECEAFF` | 8,3 | `#C2BCFF` / `#221D5C` | 8,5 | 6,1 · 6,3 |
| `progress` | `#1A45CC` / `#E6EDFF` | 6,5 | `#A9C0FF` / `#16255A` | 8,1 | 5,4 · 6,9 |
| `neutral` | `#3A4560` / `#E7EBF3` | 8,0 | `#C8CFE6` / `#1A2447` | 9,7 | 5,1 · 6,9 |

Tout le texte des pastilles dépasse 4,5:1 et chaque symbole 3:1. Le fond de la
pastille ne se distingue de la carte qu'à 1,1–1,3:1 : la pastille est
identifiée par son texte et son symbole, pas par sa forme seule.

## 10. Contrats utilisés et manques

| Besoin | Contrat (`09`) | Manque |
|---|---|---|
| Catalogue, fiche | §11.1–11.2, `AssetView` §8.2 | Routes absentes de `dev` (CAT-01 #25, RDY-02 #34) |
| Réservation | §14.1–14.4, `currentWindow` §8.6 | Routes absentes de `dev` (RES-01 #37, RES-02 #38) |
| Retrait, retour, suivi, scan | §15.1–15.5, `LockerOperationView` §8.5 | Routes absentes de `dev` (CHK-01 #46, CHK-02 #47, LOC-02 #44, RET-01 #50, RET-02 #51); motifs d'échec en chaîne libre (C8) |
| Statut du casier | §16.1 | Route absente de `dev` |

Aucun contrat n'est modifié par cette proposition.

## 11. Décisions à valider (une seule demande)

1. La transposition v3 aux écrans intérieurs (§2) : fonds, cartes, pastilles,
   bouton, opération guidée plein écran.
2. Les couleurs de statut du prototype reprises sur les surfaces v3 (§9).
3. Les textes proposés et toutes les traductions anglaises (§8).
4. L'écran de progression proposé (§7.3) : cellule en grand, liste des six
   phases, annonces VoiceOver à 30 s et 10 s.
5. Le comportement hors ligne : dernière donnée affichée et marquée « non
   actualisée », actions désactivées tant qu'elle n'est pas relue (§3–§6).

## 12. Captures

`captures/`, 29 rendus, iPhone 17 (simulateur iOS 26.3.1), données fictives,
en français et en anglais, clair et sombre, et en très grand texte. Liste et
procédure : `captures/README.md`.

## 13. Limites

- Prototype statique : aucune API, aucune caméra, aucun casier. La
  progression physique et le scan ne sont validés que sur le casier et
  l'iPhone réels.
- Contrastes calculés sur les valeurs des jetons, pas mesurés sur appareil.
- VoiceOver, Taille du texte et Réduire les animations décrits ici seront
  vérifiés par les tests de chaque story d'implémentation.
