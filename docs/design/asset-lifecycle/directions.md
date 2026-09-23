# Aegis — Directions visuelles concurrentes : iOS et Web

> **Statut au 23 septembre 2026 : non approuvé, remplacé.** Aucune de ces
> directions n'a été sélectionnée. L'identité bleu–indigo en clair et sombre,
> avec verre mesuré, a été retenue à leur place (`direction-validee.md`); les
> recommandations « sombre par défaut, sans dégradé » ci-dessous et les
> polices citées ne s'appliquent plus. La structure des écrans est reprise
> dans `sections.md` (proposition). Les SVG `wireframes/*.svg` et
> `directions/*.svg` sont conservés comme trace, **non approuvés et
> remplacés**, avec ces défauts connus :
>
> - Web : `CAM-014` emprunté et en retard affiché `[ PRÊT ]` (un actif
>   emprunté n'est jamais prêt, `sections.md` §1.2);
> - codes bruts dans des libellés principaux : `AVAILABLE`, `UNAVAILABLE`,
>   `BORROWED`, `RESERVED`, `[ BLOQUÉ · CALIBRATION_EXPIRED ]`,
>   `EXPECTED_ASSET_NOT_OBSERVED`, « marquée EXPIRED », « prêt COMPLETED /
>   ACTIVE », « RENDRE AVANT (reservedUntil) »;
> - navigation Web non conforme aux six sections retenues (« Actifs »,
>   « Prêts », « Catalogue », « Horaires du casier »);
> - tuile iOS B : l'étape « Ouvrez, retirez, refermez » n'est pas liée à un
>   état; la consigne d'ouverture n'est permise qu'à partir de
>   `COMMAND_ACKNOWLEDGED` (`sections.md` §1.4).

**Mode :** Prototype (aegis-product-design)
**Étape :** Exploration de directions visuelles (gate B de `design-workflow.md`).
Aucune haute fidélité, aucune implémentation. Sélection humaine requise avant
de poursuivre.
**Voir aussi :** `brief.md` (critique de l'existant, utilisateurs, contraintes),
`states.md` (matrice d'états), `wireframes/` (basse fidélité, hiérarchie
proposée, jamais validée).

---

## 0. Ce que les wireframes basse fidélité proposaient (gate A non franchi)

Avant de comparer des directions visuelles, les wireframes
(`wireframes/ios-parcours-technicien-lowfi.svg`,
`wireframes/web-console-administrateur-lowfi.svg`) proposaient, en gris
uniquement :

- où se trouve l'utilisateur (catalogue → détail/réservation → opération
  physique côté iOS ; vue d'ensemble → table filtrée → inspecteur côté Web) ;
- le statut dominant, toujours en forme + texte entre crochets, jamais en
  couleur seule ;
- l'action sûre suivante à chaque étape ;
- la distinction entre intention (réservation, QR affiché) et confirmation
  physique (`CONFIRMED` uniquement) ;
- un chemin d'anomalie explicite, visuellement séparé du chemin nominal
  (bordure pointillée), sur iOS comme sur Web.

Les directions ci-dessous ne changent pas cette hiérarchie ; elles proposent
des habillages, densités et signatures différents pour l'exprimer.

---

## 1. Méthode

Pour chaque direction : contexte utilisateur, rôle principal de l'écran,
qualité émotionnelle visée, information dominante, signature visuelle
distinctive, contraintes d'accessibilité, ce que la direction évite
délibérément — conformément à `references/visual-quality-bar.md`. Les tuiles
de style (`directions/ios-directions-tuiles.svg`,
`directions/web-directions-tuiles.svg`) montrent palette, typographie et un
fragment de composition — ce ne sont pas des écrans terminés, et elles ne
doivent pas être approuvées comme telles.

Palette de base commune aux deux plateformes (à raffiner à l'étape suivante,
gate B → C) : famille bleu-gris industriel déjà présente dans l'identité
Aegis, mais disciplinée — un seul accent par direction, pas de dégradé, pas
d'ombre portée décorative, conformément à `visual-quality-bar.md`.

---

## 2. Directions iOS (Aegis Mobile)

### A · Instrument de bord (recommandée)

- **Utilisateur et contexte :** technicien en atelier, parfois ganté,
  décisions rapides sous pression de temps (fenêtres de 60 s et 120 s).
- **Rôle principal :** rendre la readiness et la progression d'opération
  illisibles d'ambiguïté en un coup d'œil.
- **Qualité émotionnelle :** précis, calme, instrumenté — comme un appareil de
  mesure professionnel, pas une app grand public.
- **Hiérarchie et agencement :** listes groupées natives (`List` avec style
  `.insetGrouped`), un badge forme + texte dominant en tête de chaque carte
  d'actif, `NavigationStack` avec grand titre.
- **Typographie et densité :** SF Pro pour les titres et le corps ; chasse
  fixe (SF Mono) réservée aux horodatages, comptes à rebours et échéances —
  jamais pour la prose. Densité standard iOS (pas de sur-densification).
- **Couleur et statut :** jetons sémantiques `readiness.ready`,
  `readiness.blocked`, `readiness.unknown`, `operation.progress`, chacun
  toujours accompagné d'un texte entre crochets.
- **Signature Aegis :** anneau de progression natif pendant la fenêtre
  physique de 120 s, avec le nom de la phase affiché en toutes lettres à côté
  — jamais l'anneau seul.
- **Adéquation plateforme :** `TabView` natif à icônes SF Symbols, feuille
  caméra système pour le scan QR, retour haptique sur confirmation/anomalie,
  cibles tactiles ≥ 44pt.
- **Accessibilité / risques :** contraste des badges à valider en usage
  extérieur/lumineux malgré le mode sombre par défaut ; prévoir une variante
  claire équivalente pour Dynamic Type et faible vision.
- **Ce que la direction évite :** icônes décoratives sans texte, dégradés,
  ombres personnalisées au-delà de l'élévation système.

### B · Carnet de terrain

- **Utilisateur et contexte :** identique, mais priorité à un ton rassurant et
  méthodique pour un geste répété plusieurs fois par jour.
- **Rôle principal :** guider une séquence physique comme une liste de
  vérification papier.
- **Qualité émotionnelle :** posée, méthodique, digne de confiance.
- **Hiérarchie et agencement :** `List` native à sections, étapes numérotées
  (1, 2, 3) plutôt que glyphes seuls, actions par balayage natif.
- **Typographie et densité :** SF Pro Text uniquement, poids réguliers,
  aucune chasse fixe ; densité légèrement plus aérée que la direction A.
- **Couleur et statut :** palette claire et chaude, mêmes jetons sémantiques
  que A avec des valeurs adaptées au fond clair.
- **Signature Aegis :** glyphes système à trait fin (`checkmark.seal`,
  `exclamationmark.triangle`, `questionmark.circle`) toujours accompagnés
  d'un libellé, étape courante mise en gras plutôt que coloriée.
- **Adéquation plateforme :** listes et balayages 100 % natifs, aucune
  composante custom.
- **Accessibilité / risques :** l'urgence d'une anomalie critique est moins
  immédiatement visible que dans la direction A ; à compenser par un badge
  ferme et un son/haptique distinct si retenue.
- **Ce que la direction évite :** tout ce qui ressemble à un tableau de bord
  temps réel — volontairement plus lent et délibéré.

### C · Console de statut mobile

- **Utilisateur et contexte :** technicien à haut volume (plusieurs dizaines
  de retraits/retours par jour), déjà expert du produit.
- **Rôle principal :** naviguer vite entre beaucoup d'actifs avec un minimum
  de gestes.
- **Qualité émotionnelle :** dense, efficace, quasi professionnelle-outillée.
- **Hiérarchie et agencement :** rangées compactes multi-colonnes façon
  Réglages/Fichiers, `segmented control` persistant, en-tête de phase
  d'opération collant (`sticky`) avec `ProgressView` natif.
- **Typographie et densité :** SF Pro Rounded pour les compteurs/chiffres, SF
  Pro Text pour le corps ; densité nettement supérieure aux directions A et B.
- **Couleur et statut :** mêmes jetons sémantiques, valeurs plus saturées pour
  rester lisibles à plus petite taille.
- **Signature Aegis :** rangées denses avec statut, casier et échéance sur une
  seule ligne scannable.
- **Adéquation plateforme :** reste native, mais la densité s'approche de la
  limite recommandée pour un écran de téléphone.
- **Accessibilité / risques :** le principal risque de cette direction —
  cibles tactiles et Dynamic Type en grande taille peuvent casser la mise en
  page dense ; nécessite des tests à la plus grande taille de texte prise en
  charge avant toute approbation.
- **Ce que la direction évite :** rien ne doit ressembler à un tableau Web
  redimensionné — chaque rangée reste un composant `List` natif, pas une
  grille personnalisée.

### Recommandation iOS

**Direction A · Instrument de bord.** Elle sert le mieux le critère
« unmistakable readiness » et la sécurité des fenêtres temporelles (60 s /
120 s), qui sont des invariants métier et pas seulement un choix esthétique.
Le Carnet de terrain (B) reste un candidat solide si l'équipe préfère un ton
plus posé pour la démonstration ; la Console de statut mobile (C) est trop
dense pour un premier déploiement et devrait rester une piste P1 pour les
utilisateurs à très haut volume.

---

## 3. Directions Web (Aegis Manager)

### A · Poste d'opérations (recommandée)

- **Utilisateur et contexte :** administrateur au clavier, sessions longues de
  diagnostic et d'audit.
- **Rôle principal :** permettre de diagnostiquer, filtrer et corriger sans
  jamais perdre le contexte de la liste filtrée.
- **Qualité émotionnelle :** précise, professionnelle, orientée outil de
  travail plutôt que tableau de bord de présentation.
- **Hiérarchie et agencement :** vue maître-détail à trois zones (navigation,
  table dense triable/filtrable, panneau d'inspection contextuel qui s'ouvre
  sans navigation complète) — inspirée des consoles d'administration
  opérationnelles (Stripe Dashboard, Linear) pour leur densité éprouvée, pas
  copiée telle quelle.
- **Typographie et densité :** Inter pour l'interface, monospace (IBM Plex
  Mono) pour identifiants (`assetCode`, `operationId`) et horodatages ; très
  dense, lignes de table compactes.
- **Couleur et statut :** mêmes jetons sémantiques que iOS A, adaptés à un
  fond sombre professionnel avec bordures visibles.
- **Signature Aegis :** l'inspecteur s'ouvre en place, jamais par redirection
  — le fil d'Ariane du filtre/de la recherche reste visible pendant
  l'investigation d'une anomalie.
- **Adéquation plateforme :** navigation clavier complète (raccourcis
  `j`/`k`, `/`), focus visible, aucune action à la souris uniquement.
- **Accessibilité / risques :** discipline de mise en page nécessaire pour
  rester lisible sur un écran 13 pouces ; prévoir un point de rupture pour
  masquer l'inspecteur sous la table plutôt que le tronquer.
- **Ce que la direction évite :** navigation qui fait perdre le contexte de
  filtre, cartes interchangeables sans hiérarchie.

### B · Salle de contrôle

- **Utilisateur et contexte :** administrateur en supervision active pendant
  une démonstration ou une session de test physique.
- **Rôle principal :** donner une vue d'état en direct du casier et des
  opérations en cours, avec les tables comme second niveau.
- **Qualité émotionnelle :** vigilante, temps réel, proche d'un poste de
  supervision (NOC).
- **Hiérarchie et agencement :** bandeau de commande persistant (état
  casier, prêts actifs, anomalies ouvertes) en tête, onglets de tables denses
  en dessous (Actifs, Réservations, Prêts, Anomalies, Audit).
- **Typographie et densité :** Inter, chiffres tabulaires pour les compteurs
  qui changent (nombre de prêts, secondes depuis dernier signal).
- **Couleur et statut :** mêmes jetons + un accent « en direct » distinct
  (cyan) réservé aux indicateurs de fraîcheur, jamais au statut métier
  lui-même.
- **Signature Aegis :** micro-battement discret (« mis à jour il y a Xs »)
  sur les compteurs seulement, désactivable en mode mouvement réduit.
- **Adéquation plateforme :** entièrement clavier-compatible, mais l'accent
  temps réel demande une gestion soignée du rafraîchissement pour ne pas
  distraire pendant une tâche de lecture longue.
- **Accessibilité / risques :** le ton « temps réel » peut sur-jouer
  l'urgence pour des tâches de gestion courantes (édition de catalogue) ; à
  réserver aux vues de supervision, pas à l'ensemble de la console.
- **Ce que la direction évite :** animation continue sur les statuts
  eux-mêmes ; l'indicateur de fraîcheur reste séparé du badge de readiness.

### C · Registre

- **Utilisateur et contexte :** administrateur en reconstruction d'audit
  (« qui détenait quoi et quand »), profil qualité/conformité.
- **Rôle principal :** faire de la chaîne de possession l'écran par défaut,
  la table de catalogue passant en second plan.
- **Qualité émotionnelle :** sobre, quasi documentaire, digne de confiance
  pour un contexte réglementaire.
- **Hiérarchie et agencement :** chronologie corrélée en écran d'accueil,
  table de catalogue accessible en tirage secondaire.
- **Typographie et densité :** forte hiérarchie typographique (tailles et
  graisses) plutôt qu'iconographie ; statuts rendus en cadres typographiques
  (`[ PRÊT ]`, `[ BLOQUÉ ]`), pas en pastilles remplies.
- **Couleur et statut :** quasi sans couleur, un seul accent d'interface ;
  les jetons sémantiques restent définis mais s'expriment surtout par le
  texte et le contour.
- **Signature Aegis :** l'écran d'accueil raconte la chaîne de possession
  avant de montrer un inventaire — cohérent avec la promesse produit, mais
  déplace le diagnostic de readiness (tâche n°1 de l'administrateur selon
  `SKILL.md`) hors du premier écran.
- **Adéquation plateforme :** entièrement clavier-compatible ; le contraste
  quasi monochrome demande une vérification WCAG rigoureuse (pas de couleur
  pour distinguer les statuts, donc le contour et le poids doivent porter
  seuls la distinction).
- **Accessibilité / risques :** le plus grand risque est fonctionnel, pas
  visuel — reléguer readiness/catalogue en second plan contredit l'objectif
  principal de la console.
- **Ce que la direction évite :** iconographie de statut, badges colorés
  pleins, tout ce qui évoque un tableau de bord marketing.

### Recommandation Web

**Direction A · Poste d'opérations.** Elle sert le mieux l'ensemble des
objectifs de la persona administrateur (gestion de catalogue, diagnostic de
readiness, supervision des réservations/prêts, investigation d'anomalie,
reconstruction d'audit) grâce à la vue maître-détail qui garde le contexte de
filtre pendant l'investigation. La Salle de contrôle (B) reste pertinente
comme mode ou vue secondaire pour la supervision en direct pendant une
démonstration, mais ne devrait pas être le paradigme de toute la console. Le
Registre (C) capture bien la promesse de chaîne de possession mais déplace la
tâche n°1 de la persona (diagnostiquer la readiness) hors de l'écran par
défaut ; ses idées (chronologie, cadres typographiques pour les statuts)
méritent d'être reprises comme composant de l'écran Audit à l'intérieur de la
Direction A plutôt que comme direction concurrente autonome.

---

## 4. Identité partagée entre les deux plateformes

Les deux directions recommandées (iOS A, Web A) partagent :

- les mêmes jetons sémantiques de statut (`readiness.ready/blocked/unknown`,
  `operation.progress`, `anomaly.open/acknowledged/resolved`) exprimés
  différemment (anneau + texte sur iOS, cadre + texte sur Web) ;
- la même règle de contenu : un statut n'est jamais affiché sans son texte ;
- la même distinction stricte entre intention et confirmation physique ;
- un fond bleu-gris industriel sombre par défaut et un accent unique par
  plateforme, sans dégradé ni ombre décorative ;
- l'usage de la chasse fixe uniquement pour identifiants, horodatages et
  comptes à rebours — jamais pour la prose.

Elles diffèrent délibérément en composition : listes groupées natives à un
seul niveau d'information par écran sur iOS, vue maître-détail dense à trois
zones sur Web. Aucune des deux n'est une version redimensionnée de l'autre.

## 5. Prochaine étape (non entamée ici)

Après sélection humaine d'une direction par plateforme (gate B), l'étape
suivante construit le système visuel partagé (jetons complets, inventaire de
composants, mapping plateforme) puis produit la haute fidélité avec la copie
française la plus longue réaliste et les états adverses, conformément à
`design-workflow.md` §4–5. Cette étape n'a pas commencé.
