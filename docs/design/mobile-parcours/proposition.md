# Aegis Mobile — parcours du technicien après la connexion

Mode : Prototype. Date : 21 octobre 2026; passe de corrections du 22 octobre
2026. Issue : #35 (DES-01). Suite de `../mobile-entree/` (connexion, approuvée
et intégrée par #36).

**Statut : proposition partiellement validée.** Ce dossier rassemble les
parcours restants de #35 : catalogue, fiche équipement, réservation,
préparation du retrait et scan du code du casier, progression physique, prêt
actif et retour.

| Élément | Statut |
|---|---|
| Structure des sections, hiérarchies, règles d'affichage et textes français de `../asset-lifecycle/sections.md` §1, §4, §6, décisions U1 à U8 | **Approuvé** le 23 septembre 2026; repris tel quel sauf mention « proposé » en §8 |
| Direction « Lumière du hub » v3, logo provisoire, apparences claire et sombre, connexion | **Approuvé** le 21 octobre 2026 (`../mobile-entree/proposition.md`) |
| Direction v3 des écrans intérieurs (sombre profond, clair distinct, surfaces sobres, bleu d'action), typographie système, cartes, statuts associant symbole et texte, structure des fiches et de Mon activité, cellule A1 mise en évidence dans le parcours guidé, principe des dernières données connues hors ligne avec ancienneté explicite | **Approuvé** le 22 octobre 2026 (revue de Philippe) |
| Corrections visuelles de la revue du 22 octobre : statuts anciens neutralisés, ancienneté visible, Réessayer, suivi interrompu, navigation native, hiérarchie en grand texte, petit écran | **Approuvé** le 22 octobre 2026 (design seulement : ne vaut validation ni de VoiceOver, ni de la caméra, ni du réseau réel) |
| Variantes « Retrait indisponible » et « Nouvelle tentative permise » de Mon activité (§6) | Visuellement acceptées; **choix de la variante en attente** de la clarification de `availableActions` (§10) |
| Textes ajoutés ou modifiés et traductions anglaises (§8.1), finitions du 22 octobre (§5, §7.3), comportements d'accessibilité | **Proposition** (ce dossier) |

Les rendus de `captures/` viennent d'un prototype SwiftUI (`prototype/`),
compilé dans une copie temporaire de `apps/ios` : données fictives, aucune
requête, aucune caméra. La navigation y est réelle (catalogue → fiche → retour,
feuille de réservation, filtres, Fermer puis Reprendre). Aucun écran métier
n'est câblé dans l'application : l'API de `dev` n'expose aujourd'hui que la
connexion, le profil et la santé.

## 1. Règles qui s'appliquent à tous les parcours

- **Autorité du backend.** L'application affiche l'état reçu
  (`LockerOperationView.status`, `requiredAction`, `availableActions`) et ne
  le déduit jamais. Ni un QR, ni une animation, ni un compte à rebours ne
  prouvent une ouverture, un retrait ou un retour. Seul `CONFIRMED` affiche un
  succès.
- **Jamais « Prêt » pour un actif emprunté** et jamais de consigne d'ouverture
  avant `COMMAND_ACKNOWLEDGED` (`sections.md` §1.2, §1.4).
- **Données non actualisées.** Une donnée qui n'a pas pu être relue reste
  affichée avec son heure de lecture, au-dessus du contenu concerné. Son statut
  n'est pas transformé : il est présenté comme « Dernier état », en couleurs
  neutres, et les actions qui en dépendent restent désactivées jusqu'à la
  relecture.
- **Codes bruts** hors des libellés : seuls le texte, le symbole et la forme
  portent l'état; le `traceId` s'affiche après « Identifiant de suivi ».
- **Heure du casier.** Les heures métier (`reservedUntil`, `dueAt`,
  fermeture, échéance d'opération) sont formatées dans le fuseau du casier
  (`currentWindow.timeZone`), suivies de l'abréviation du fuseau (« 16:30
  HAE », « 4:30 PM EDT »). La langue et le format de l'heure suivent les
  réglages de l'appareil : l'application n'impose ni fr-CA ni en-CA. Les
  exemples « 16 h 30 » de ce document illustrent le texte, pas le format.
- **Noms saisis** (équipement, modèle, code) affichés tels quels, sans
  traduction.
- **Statut toujours triple** : symbole, forme de pastille et texte; jamais la
  couleur seule.
- **Erreurs** : une phrase courte, issue du code; le `detail` du serveur n'est
  jamais affiché. Un 401 renvoie à la connexion (session expirée ou invalide,
  #36); un 403 refuse l'action sur place sans fermer la session.
- **Idempotence** : une nouvelle tentative de la même intention réutilise sa
  clé (`Idempotency-Key`); un double appui est ignoré pendant l'envoi.

## 2. Système visuel des écrans intérieurs

| Élément | Règle |
|---|---|
| Navigation | `TabView` natif à trois onglets approuvé : Équipements (`shippingbox`), Mon activité (`checklist`), Compte (`person.crop.circle`); grands titres natifs. La fiche est poussée dans la pile du catalogue, avec le retour natif « Équipements ». |
| Fond | `BrandTop` (clair `#EDF2FA`, sombre `#070D17`), sans halo derrière les listes |
| Cartes | `BrandPanel` (`#FFFFFF` / `#0D1520`), coins continus de 20 pt, filet `BrandBorder` |
| Pastille de statut | Capsule : symbole SF + texte, couleurs `ready`, `blocked`, `unknown`, `mine`, `progress`, `neutral` du prototype (`../asset-lifecycle/prototype/tokens/brand.css`), en clair et en sombre |
| Bouton principal | Bouton v3 de la connexion (54 pt, coins de 14 pt, fond `AccentColor`) |
| Texte d'action | `BrandAccent` (`#234BCE` / `#8CAEFF`) pour les actions en texte (Fermer, Annuler, Réessayer). `AccentColor` sombre (`#315EE8`) ne sert qu'aux fonds : en texte sur le fond sombre, il n'atteint que 3,61:1. |
| Filtres | Puces de 44 pt de haut au minimum, défilement horizontal; en tailles d'accessibilité, un menu natif « Filtre : Tous » remplace les puces |
| Chargement | Cartes squelettes neutres, sans couleur de statut |
| Opération guidée | Plein écran (`fullScreenCover`) avec barre native : **Fermer** à gauche, « Retrait guidé » au centre. Cellule en très grand (« A1 »), titre d'étape, consigne unique, temps restant libellé, liste des étapes. |
| Mouvement | Transitions natives courtes; aucune animation de porte ou de déverrouillage; Réduire les animations supprime les transitions décoratives |

## 3. Catalogue (onglet Équipements)

**Objectif** (approuvé) : trouver un équipement et savoir immédiatement s'il
est prêt **pour moi**, sinon pourquoi.

**Composition** : recherche native (`searchable`, « Code ou modèle ») →
filtres (Tous · Prêt · Bloqué · À vérifier) → cartes : pastille de statut,
puis modèle et code, puis raison principale ou cellule → pied « État évalué à
14 h 30 HAE, heure du casier. » Tirer pour actualiser.

| État | Déclencheur | Affichage | Accessibilité |
|---|---|---|---|
| Chargement | Première lecture `GET /assets` | Trois cartes squelettes neutres (aucune pastille colorée) | Un seul élément « Chargement des équipements » |
| Liste | 200 | Cartes; statut selon `sections.md` §1.2 | Chaque carte est un seul élément : « Prêt, Multimètre 1, MM-001, disponible dans la cellule A1 » |
| Aucun résultat | 200, liste vide avec recherche ou filtre | « Aucun équipement ne correspond. » + **Effacer les filtres** | Annonce du résultat |
| Catalogue vide | 200, liste vide sans filtre | « Aucun équipement n'est encore disponible. » | — |
| Hors ligne | Erreur réseau | **Au-dessus des cartes** : « Connexion au service impossible. Vérifiez le réseau. » + « Informations non actualisées depuis 14 h 30 HAE. » + bouton **Réessayer**. Les cartes restent visibles; chaque pastille devient « Dernier état : Prêt » en couleurs neutres, symbole d'origine conservé; le pied disparaît | Pastille lue « Dernier état connu, non actualisé : Prêt »; annonce du bandeau |
| Erreur du service | 5xx | « Le service n'a pas pu charger les équipements. » + Identifiant de suivi | — |
| Session | 401 | Retour à la connexion (#36) | — |

## 4. Fiche équipement

**Composition** (approuvée) : statut et identité (modèle, code, fabricant) →
toutes les raisons, la principale en premier avec sa suite actionnable
(`sections.md` §1.3) → calibration (échéance) → niveau d'accès requis →
cellule → **Réserver**, actif seulement si `readiness.result = READY`, sinon
désactivé avec la raison sous le bouton. Ouverte depuis une carte du
catalogue; retour natif vers la liste.

| État | Déclencheur | Affichage |
|---|---|---|
| Prêt | `READY` | Pastille Prêt; Réserver actif |
| Réservé pour vous | Réservation active du technicien sur cet actif | Pastille « Réservé pour vous » (`mine`); bouton **Voir mon activité** |
| Bloqué | `BLOCKED` | Pastille Bloqué; liste des raisons; Réserver désactivé : « Réservation impossible : calibration expirée. » |
| Emprunté / Déjà réservé | `NOT_AVAILABLE` | Libellés de §1.2; aucun détail sur un autre titulaire |
| Accès insuffisant | `ACCESS_DENIED` | « Niveau d'accès insuffisant » + « Demandez l'accès à un administrateur. » |
| À vérifier | `UNKNOWN` | Pastille À vérifier (`unknown`, losange) : « Présence non confirmée par le casier. » |
| Introuvable | 404 | « Cet équipement n'est plus disponible. » + retour à la liste |
| Hors ligne | Erreur réseau | Dernière fiche affichée, pastille « Dernier état : … », note « Informations non actualisées depuis 14 h 30 HAE. »; Réserver désactivé avec « Réservation possible après actualisation de la fiche. » |

Le bouton reste une affordance : le serveur revalide tout au moment de la
réservation.

## 5. Réservation (feuille)

**Composition** (approuvée) : équipement et cellule → « Réserver jusqu'à »
(`reservedUntil`, sélecteur natif dans le fuseau du casier, pas de 15 min)
bornée par `currentWindow.closesAt` → fermeture du casier → « Retirez
l'équipement avant cette heure. Elle sera aussi l'heure de retour prévue. » →
note « Heures du casier : heure avancée de l'Est. » → rappel séparé « La
réservation n'ouvre aucune porte. » → **Confirmer la réservation**, fixé en
bas de la feuille pour rester atteignable en très grand texte.

L'heure choisie a deux conséquences, et la feuille les dit toutes deux : elle
borne le retrait (la réservation expire à `reservedUntil`, `06` §14) et, au
retrait confirmé, elle est copiée dans `Loan.dueAt` (`06` §11.1). Aucune règle
métier n'est ajoutée par l'application.

| État | Déclencheur | Affichage |
|---|---|---|
| Chargement de la plage | `GET /lockers/{id}/status` | Sélecteur désactivé, indicateur |
| Casier fermé | `currentWindow.open = false` | « Le casier est fermé. Réouverture à 7 h 00 HAE. » (ou « Aucun horaire d'ouverture. »); confirmation désactivée |
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
| Réservation active | `ReservationView.ACTIVE` | « Réservé pour vous » · « À retirer avant 16 h 30 HAE » | **Préparer le retrait** | Annuler la réservation (confirmation approuvée) |
| Retrait indisponible (variante, sélection en attente) | Le retrait ne figure pas dans `availableActions`; le casier est hors ligne (`LockerStatusView.connectionStatus = OFFLINE`) | Avis dans la carte : « Retrait indisponible : le casier est hors ligne. » + « Dernier signal du casier à 14 h 28 HAE. Actualisez pour vérifier à nouveau. » | **Préparer le retrait** désactivé (cadenas), juste sous l'avis, puis **Actualiser**, seule action principale active | Annuler la réservation (lien) |
| Nouvelle tentative permise (variante, sélection en attente) | Le retrait figure dans `availableActions` après un `503 LOCKER_OFFLINE` | Avis : « Essai de 14 h 32 HAE : le casier était hors ligne. » + « Vous pouvez faire une nouvelle tentative. Aucune porte ne s'ouvre sans le code du casier. » | **Nouvelle tentative de retrait** | Annuler la réservation |
| Réservation expirée | `EXPIRED` | « Votre réservation a expiré à 16 h 30. » | **Voir les équipements** | — |
| Opération en cours | `currentOperationId` non terminal | Pastille « Retrait en cours » / « Retour en cours » · « Suivi masqué. L'opération n'est pas annulée. » | **Reprendre** (relit l'opération, ne redéclenche rien) | — |
| Prêt actif | `LoanView.ACTIVE` | « Emprunté par vous » · « Retour prévu à 16 h 30 HAE » | **Retourner l'équipement** | Voir l'équipement |
| Prêt en retard | `overdue = true` | « Emprunté par vous » · « En retard depuis 16 h 30 HAE — rapportez l'équipement. » | **Retourner l'équipement** | — |
| Retour en attente | `RETURN_PENDING` | « Retour en attente de vérification. » | **Reprendre** si une opération est en cours; sinon selon `availableActions` | — |
| Chargement / hors ligne | — | Carte squelette neutre / avis réseau au-dessus, dernière carte en « Dernier état » | Actions désactivées jusqu'à la relecture | **Réessayer** |

Les boutons suivent `availableActions`; l'application ne recalcule pas les
actions permises. Le statut du casier explique un refus, il ne décide rien.
Les valeurs de `availableActions` ne sont pas encore énumérées dans `09` (§10).
Les deux variantes « casier hors ligne » sont des maquettes acceptées, pas une
règle : la session principale, propriétaire de `09`, doit formaliser les
valeurs et la conduite dans quatre cas — casier actuellement hors ligne,
ancien échec suivi d'une nouvelle lecture, téléphone sans accès à l'API,
opération déjà engagée à reprendre. Cette matrice et ses exemples seront
alignés sur la clarification approuvée; d'ici là, l'application n'invente ni
valeur d'action ni logique d'autorisation.

## 7. Retrait et retour guidés

### 7.1 Préparation

**Préparer le retrait** (`POST /reservations/{id}/checkout`) ou **Retourner
l'équipement** (`POST /loans/{id}/return`) ouvre l'opération guidée. La
réponse `202` ne crée aucune commande de serrure.

| Refus à la préparation | Message |
|---|---|
| `409 LOCKER_OPERATION_IN_PROGRESS` | « Le casier est occupé par une autre opération. Réessayez dans un instant. » |
| `503 LOCKER_OFFLINE` | « Le casier est hors ligne. Réessayez plus tard. » puis la carte de Mon activité suit `availableActions` (§6) |
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

**Écran** : cellule en très grand → titre de l'étape → consigne unique →
temps restant → liste verticale des six phases (Demande, Code du casier,
Autorisation, Commande, Porte, Vérification) avec l'étape courante mise en
évidence → action éventuelle → note sur **Fermer**. En taille normale,
l'identité de l'équipement suit la cellule sur la même ligne.

**Très grand texte** (tailles d'accessibilité) : la barre native garde
**Fermer** et « Retrait guidé » compacts (les éléments de barre utilisent la
loupe d'accessibilité au lieu de grandir). L'ordre devient cellule → titre →
consigne → avis éventuel (suivi interrompu, symbole au-dessus du texte) →
temps restant → identité (empilée) → étapes → actions. Le titre
passe en chasse condensée pour garder les mots longs entiers
(« Déverrouillage »), sans plafonner la taille choisie. Tout défile; les
actions du bas restent atteignables.

**Temps restant** : libellé « Temps restant », valeur en chiffres tabulaires,
puis « Échéance : 14 h 36 HAE » (« Échéance reçue : … » quand le suivi est
interrompu). Le décompte part de l'`expiresAt` reçu et utilise l'horloge de
l'appareil. À zéro, il reste à 0:00 avec « Échéance atteinte : en attente de
confirmation du service. » L'application demande l'état au service si le
réseau le permet; tant qu'aucune réponse n'arrive, l'écran reste dans cet
état, sans promettre de délai. Elle ne déduit jamais localement `CONFIRMED`,
`EXPIRED`, `FAILED`, `ANOMALY` ni aucun autre résultat : seul l'état reçu
change le titre (« Délai dépassé » n'apparaît qu'avec `EXPIRED` reçu). VoiceOver lit « Temps restant, 1 minute, 41
secondes »; annonces automatiques seulement à 30 s et 10 s.

| Attente ou échec matériel | Affichage |
|---|---|
| Réseau perdu pendant le suivi | Avis ambre en tête : « Suivi interrompu : connexion perdue » + « Ce n'est ni une annulation ni une confirmation. L'état sera relu dès le retour du réseau. » Titre : « Dernier état reçu : porte ouverte » (jamais l'affirmation « Porte ouverte »). Étape courante marquée d'un symbole pause, lue « dernier état reçu, suivi interrompu ». Le temps restant continue vers l'échéance reçue, avec « Échéance reçue : 14 h 36 HAE »; à zéro, « Échéance atteinte : en attente de confirmation du service. » L'interruption ne promet aucune relecture à heure fixe : la relecture se fait au retour du réseau (suivi ralenti puis repris, `09` §15.4). |
| Application en arrière-plan | Suivi suspendu; relecture immédiate au retour |
| Porte restée fermée | `EXPIRED` : « Délai dépassé. Aucune porte n'a été ouverte. Recommencez la préparation. » Bouton **Recommencer** (libellé court, en chasse condensée aux tailles d'accessibilité comme le titre, pour garder le mot entier en AX5 sans plafonner la taille); VoiceOver lit « Recommencer le retrait » avec l'indice « Un nouveau code s'affichera sur le casier. » |
| Échec sûr | `FAILED` : « Opération arrêtée sans ouverture. Vous pouvez recommencer. »; motif générique tant que `failureReason` reste une chaîne libre (C8) |
| Incertitude physique | `ANOMALY` : « Intervention requise. Ne réessayez pas. Un administrateur doit vérifier la cellule A1. » |
| Session expirée en cours | Retour à la connexion, avec l'information que l'opération du casier n'est pas annulée; reprise par `currentOperationId` après connexion |

**Fermer** masque l'opération guidée sans l'annuler et sans confirmation
supplémentaire. Tant que l'opération n'est pas terminale, une note en bas de
l'écran le dit : « Fermer masque ce suivi sans annuler l'opération.
Reprenez-le depuis Mon activité. »; VoiceOver lit le même indice sur le
bouton. Après Fermer, Mon activité montre « Retrait en cours · Suivi masqué.
L'opération n'est pas annulée. » et **Reprendre**, qui relit l'opération.
Aucun bouton ne termine ni ne confirme une opération.

**Retour** : mêmes étapes, consigne « déposez »; après `CONFIRMED`, « Retour
confirmé » puis Mon activité vide.

**Accessibilité** : chaque changement d'étape est annoncé une fois (titre et
consigne); le compte à rebours n'est pas annoncé chaque seconde; retours
haptiques en appui seulement; aucune information portée par la seule couleur
ou le seul mouvement.

## 8. Textes (français de référence, anglais proposé)

Les textes français marqués « approuvé » viennent de `sections.md`; leurs
traductions et les autres textes sont **proposés**. Les heures sont formatées
par l'appareil (§1).

| Clé | Français | English | Statut FR |
|---|---|---|---|
| Onglets | Équipements · Mon activité · Compte | Equipment · My activity · Account | approuvé |
| Recherche | Code ou modèle | Code or model | proposé |
| Filtres | Tous · Prêt · Bloqué · À vérifier | All · Ready · Blocked · Needs checking | approuvé |
| Pied de liste | État évalué à 14 h 30 HAE, heure du casier. | Status checked at 2:30 PM EDT, locker time. | proposé |
| Vide | Aucun équipement ne correspond. | No equipment matches. | approuvé |
| Cellule | Disponible dans la cellule A1 | Available in compartment A1 | approuvé |
| Réserver | Réserver · Confirmer la réservation | Reserve · Confirm reservation | approuvé |
| Statuts | Prêt · Réservé pour vous · Déjà réservé · Emprunté par vous · Emprunté · Indisponible · Bloqué · À vérifier | Ready · Reserved for you · Already reserved · Borrowed by you · Borrowed · Unavailable · Blocked · Needs checking | approuvé |
| Actions | Préparer le retrait · Retourner l'équipement · Reprendre · Annuler la réservation | Prepare checkout · Return equipment · Resume · Cancel reservation | approuvé |
| Aucune activité | Aucune réservation ni prêt en cours. | No reservation or loan in progress. | approuvé |
| Scan | Scannez le code affiché sur le casier · Aucune porte n'est ouverte. | Scan the code shown on the locker · No door is open. | approuvé |
| Autorisé | Accès autorisé · N'ouvrez pas encore. | Access authorized · Don't open yet. | approuvé |
| Succès | Retrait confirmé · Retour confirmé | Checkout confirmed · Return confirmed | approuvé |

### 8.1 Textes ajoutés ou modifiés le 22 octobre (à valider)

| Où | Français | English | Statut |
|---|---|---|---|
| Catalogue et fiche hors ligne | Informations non actualisées depuis 14 h 30 HAE. | Not up to date since 2:30 PM EDT. | FR proposé (« Informations non actualisées » approuvé, complété de l'heure) |
| Catalogue hors ligne | Réessayer | Try again | proposé (glossaire) |
| Pastille non actualisée | Dernier état : Prêt | Last known: Ready | proposé |
| Pastille, VoiceOver | Dernier état connu, non actualisé : Prêt | Last known status, not up to date: Ready | proposé |
| Fiche hors ligne | Réservation possible après actualisation de la fiche. | You can reserve once this page is up to date. | proposé |
| Filtres, très grand texte | Filtre : Tous | Filter: All | proposé |
| Raison bloquée | Calibration expirée depuis le 8 sept. 2026 | Calibration expired on Sep 8, 2026 | FR inchangé; EN corrigé |
| Feuille de réservation, sélecteur (remplace « Heure de retour » · « Return by ») | Réserver jusqu'à | Reserve until | demandé par Philippe le 22 octobre; glossaire en attente (session principale) |
| Feuille de réservation, conséquences de l'heure (remplace la première moitié du rappel approuvé) | Retirez l'équipement avant cette heure. Elle sera aussi l'heure de retour prévue. | Pick up the equipment before this time. It will also be the expected return time. | demandé par Philippe le 22 octobre (`06` §11.1); glossaire en attente |
| Rappel de réservation, séparé | La réservation n'ouvre aucune porte. | Reserving does not unlock the compartment. | FR repris du rappel approuvé; glossaire en attente |
| Feuille de réservation | Heures du casier : heure avancée de l'Est. | Locker time: Eastern Daylight Saving Time. | proposé (nom du fuseau fourni par le système) |
| Retrait indisponible | Retrait indisponible : le casier est hors ligne. · Dernier signal du casier à 14 h 28 HAE. Actualisez pour vérifier à nouveau. | Checkout unavailable: the locker is offline. · Locker last seen at 2:28 PM EDT. Refresh to check again. | proposé |
| Nouvelle tentative | Essai de 14 h 32 HAE : le casier était hors ligne. · Vous pouvez faire une nouvelle tentative. Aucune porte ne s'ouvre sans le code du casier. · Nouvelle tentative de retrait | Attempt at 2:32 PM EDT: the locker was offline. · You can try again. No door opens without the locker code. · Try checkout again | proposé |
| Actualiser | Actualiser | Refresh | proposé (glossaire) |
| Opération masquée | Retrait en cours · Suivi masqué. L'opération n'est pas annulée. | Checkout in progress · Tracking hidden. The operation is not cancelled. | proposé (le cas « Opération en cours » est approuvé, pas son libellé) |
| Note Fermer | Fermer masque ce suivi sans annuler l'opération. Reprenez-le depuis Mon activité. | Close hides this tracking without cancelling the operation. Resume it from My activity. | proposé |
| Indice VoiceOver de Fermer | Masque le suivi sans annuler l'opération. | Hides tracking without cancelling the operation. | proposé |
| Réseau perdu (remplace « Connexion perdue. L'opération continue sur le casier… ») | Suivi interrompu : connexion perdue · Ce n'est ni une annulation ni une confirmation. L'état sera relu dès le retour du réseau. | Tracking interrupted: connection lost · This neither cancels nor confirms the operation. Its status will be read again when the network is back. | proposé |
| Titre réseau perdu (remplace « Porte ouverte ») | Dernier état reçu : porte ouverte | Last status received: door open | proposé |
| Étape, VoiceOver | dernier état reçu, suivi interrompu | last status received, tracking interrupted | proposé |
| Temps restant | Temps restant · Échéance : 14 h 36 HAE | Time remaining · Deadline: 2:36 PM EDT | proposé |
| Temps restant, réseau perdu | Échéance reçue : 14 h 36 HAE | Deadline received: 2:36 PM EDT | proposé |
| Temps restant à zéro | Échéance atteinte : en attente de confirmation du service. | Deadline reached: waiting for the service to confirm. | FR demandé par Philippe le 22 octobre; EN proposé |
| Délai dépassé, bouton (remplace « Recommencer la préparation ») | Recommencer · VoiceOver : Recommencer le retrait · indice : Un nouveau code s'affichera sur le casier. | Start again · VoiceOver: Start the checkout again · hint: A new code will appear on the locker. | libellé visible demandé par Philippe le 22 octobre; libellé et indice VoiceOver proposés |
| Déverrouillage | Ouvrez la porte A1 et retirez « Multimètre 1 ». Si elle reste fermée, ne forcez pas et attendez le message suivant. | Open door A1 and take “Multimètre 1”. If it stays shut, don't force it; wait for the next message. | FR proposé : le nom saisi remplace « le multimètre » approuvé, que le contrat ne fournit pas |
| Retard | En retard depuis 16 h 30 HAE — rapportez l'équipement. | Overdue since 4:30 PM EDT. Please bring the equipment back. | FR approuvé; EN revu |
| Autres anglais revus | — | Why it's blocked · Browse equipment · View my activity · Stand in front of the locker screen. · Code appearing on the locker · Start the checkout again. · Start again · Due back at … · Allow camera access in Settings to scan the code. · Scanning unlocks nothing until the server authorizes it. | EN proposé |

Les autres messages de refus reprennent `sections.md` §4.1, §4.2 et §6; leur
version anglaise suivra le glossaire partagé (`docs/localisation/`).

## 9. Contrastes

Texte de la pastille sur son fond (valeurs du prototype `brand.css`) :

| Statut | Clair (texte / fond) | Ratio | Sombre (texte / fond) | Ratio | Symbole / fond (clair, sombre) |
|---|---|---:|---|---:|---|
| `ready` | `#0B6B3F` / `#E1F4EA` | 5,7 | `#6FE3A8` / `#0E2E2A` | 9,2 | 4,2 · 7,7 |
| `blocked` | `#A3161A` / `#FCE7E6` | 6,6 | `#FFA59E` / `#3A1424` | 8,5 | 4,7 · 6,3 |
| `unknown` | `#7A4B00` / `#FFF0D1` | 6,6 | `#FFD27A` / `#33280F` | 10,2 | 4,2 · 9,0 |
| `mine` | `#3726B8` / `#ECEAFF` | 8,3 | `#C2BCFF` / `#221D5C` | 8,5 | 6,1 · 6,3 |
| `progress` | `#1A45CC` / `#E6EDFF` | 6,5 | `#A9C0FF` / `#16255A` | 8,1 | 5,4 · 6,9 |
| `neutral` (dont « Dernier état ») | `#3A4560` / `#E7EBF3` | 8,0 | `#C8CFE6` / `#1A2447` | 9,7 | 5,1 · 6,9 |

Éléments ajoutés par la passe du 22 octobre (calculés sur les valeurs des
jetons) :

| Élément | Clair | Sombre |
|---|---:|---:|
| Fermer, Annuler, liens (`BrandAccent` sur `BrandTop`) | 6,29 | 8,91 |
| Réessayer, Annuler la réservation (`BrandAccent` sur `BrandPanel`) | 7,07 | 8,39 |
| Avis hors ligne (`ErrorText` sur `ErrorFill`) | 6,75 | 10,20 |
| Avis ambre « Suivi interrompu » (`unknown`) | 6,58 | 10,17 |
| Notes, « Temps restant » (`BrandMuted` sur `BrandTop`) | 5,37 | 9,78 |
| Détail non actualisé (`BrandMuted` sur `BrandPanel`) | 6,04 | 9,21 |
| Symbole pause (`unknown` symbole sur `BrandPanel`) | 4,68 | 11,40 |
| Bouton principal désactivé (`BrandMuted` sur `BrandField`) | 5,53 | 8,35 |
| Pour mémoire : ancien Fermer (`AccentColor` sombre sur `BrandTop`) | 6,29 | **3,61** (corrigé) |

Tout le texte dépasse 4,5:1 et chaque symbole 3:1. Le fond de la pastille ne
se distingue de la carte qu'à 1,1–1,3:1 : la pastille est identifiée par son
texte et son symbole, pas par sa forme seule. Sur iOS 26, les boutons de barre
reposent sur un fond de verre : leur contraste réel reste à mesurer sur
appareil.

## 10. Contrats utilisés et manques

| Besoin | Contrat (`09`) | Manque |
|---|---|---|
| Catalogue, fiche | §11.1–11.2, `AssetView` §8.2 | Routes absentes de `dev` (CAT-01 #25, RDY-02 #34) |
| Réservation | §14.1–14.4, `currentWindow` §8.6 | Routes absentes de `dev` (RES-01 #37, RES-02 #38) |
| Retrait, retour, suivi, scan | §15.1–15.5, `LockerOperationView` §8.5 | Routes absentes de `dev` (CHK-01 #46, CHK-02 #47, LOC-02 #44, RET-01 #50, RET-02 #51); motifs d'échec en chaîne libre (C8) |
| Statut du casier | §16.1, `LockerStatusView` §8.6 | Route absente de `dev` |
| Actions permises dans Mon activité | `availableActions` (§8.3–8.4, `string[]`) | **Valeurs non énumérées**, et rien ne dit si un casier hors ligne retire le retrait des actions permises. Demande transmise le 22 octobre à la session principale (propriétaire de `09`) : valeurs approuvées pour la réservation et le prêt; conduite pour un casier actuellement hors ligne, un ancien échec suivi d'une nouvelle lecture, un téléphone sans accès à l'API et une opération déjà engagée; raison lisible par machine si une action est retirée; motif et heure d'un échec dû au casier (C8); dernier signal et fuseau du casier sur la carte, ou appel à `GET /lockers/{id}/status`. **Référence commune : en attente.** |

Aucun contrat n'est modifié par cette proposition.

## 11. Décisions encore nécessaires

1. Valider les textes de §8.1 encore proposés, dont deux changements du
   français approuvé : le nom saisi dans la consigne de déverrouillage, et le
   nouveau message de réseau perdu qui remplace « L'opération continue sur le
   casier ». Les textes de réservation et « Échéance atteinte » viennent de la
   revue du 22 octobre; leurs entrées de glossaire restent à faire par la
   session principale.
2. `availableActions` : clarification de contrat demandée à la session
   principale (§10), puis approbation. La matrice de §6 sera alignée ensuite.
3. Valider la présentation « Dernier état : … » en couleurs neutres pour les
   statuts non actualisés.

## 12. Captures

`captures/`, rendus de l'iPhone 17 (simulateur iOS 26.3.1) et de l'iPhone SE
(3e génération, simulateur iOS 17.5, la version majeure de la cible
minimale), données fictives, en français et en anglais, clair et sombre, et en
très grand texte (AX5). Liste et procédure : `captures/README.md`.

## 13. Limites

- Prototype : aucune API, aucune caméra, aucun casier. La progression
  physique et le scan ne sont validés que sur le casier et l'iPhone réels.
- Observé sur simulateur : rendus, navigation (catalogue → fiche → retour,
  Réserver → Annuler, Fermer → Mon activité → Reprendre, sélection d'un
  filtre), défilement en très grand texte; captures dans
  `captures/interactions/`. Le prototype sélectionne le filtre mais ne
  filtre pas la liste. **Spécifié seulement** : VoiceOver (libellés et
  annonces), comportement réseau réel, attente et relecture à zéro, caméra,
  haptique.
- Contrastes calculés sur les valeurs des jetons, pas mesurés sur appareil.
- VoiceOver, Taille du texte et Réduire les animations seront vérifiés par
  les tests de chaque story d'implémentation.
