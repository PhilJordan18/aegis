# Aegis — Brief de conception : readiness, réservation, retrait et retour

**Mode :** Prototype (aegis-product-design)
**Flux couvert :** cycle de vie visible d'un actif — readiness, réservation,
retrait (checkout), prêt, retour — sur iOS (technicien) et Web (administrateur).
**Statut :** Discovery/Prototype non approuvé. Aucune implémentation n'a démarré
(`apps/admin-web` et `apps/ios` ne contiennent que `.gitkeep`).
**Mise à jour du 23 septembre 2026 :** l'identité bleu–indigo avec dégradés
lumineux et verre mesuré a depuis été retenue (`direction-validee.md`); la
critique §1.4 vise l'usage sans justification, pas ce principe. La structure
des sections proposée est dans `sections.md` (non approuvée).
**Sources consultées :** `docs/cahier-conception/02-scope.md`,
`05-machines-a-etats.md`, `09-contrats-rest.md` (sections 8.1–8.7),
`docs/design/aegis-parcours-ui.svg`, `.claude/skills/aegis-product-design/`
(SKILL.md, `references/design-workflow.md`, `references/visual-review-protocol.md`,
`references/visual-quality-bar.md`).

---

## 1. Constat sur l'existant

Le seul artefact de design présent dans le dépôt est
`docs/design/aegis-parcours-ui.svg` : une planche unique de 1440×900 combinant
deux écrans iOS et un tableau de bord Web dans un même fond dégradé bleu nuit.
Aucun autre wireframe, état, ou spécification n'existe. Cet artefact est
exactement la situation que `references/design-workflow.md` met en garde
contre : *« Do not create a one-shot polished SVG as the only design artifact
for a substantial flow. »* Il n'a jamais été soumis à une revue visuelle
(`references/visual-review-protocol.md`) et ne peut donc pas être qualifié de
haute fidélité ni prêt pour l'implémentation.

La critique ci-dessous ne corrige rien : elle documente pourquoi cette planche
ne peut pas servir de point de départ tel quel, avant d'explorer de nouvelles
directions à partir d'un flux validé.

### 1.1 Flux

- Le parcours complet du P0 (connexion, catalogue, réservation avec choix de
  `reservedUntil`, préparation du retrait, scan QR, attente de preuve
  physique, confirmation, prêt actif, préparation du retour, confirmation du
  retour, anomalies) n'est représenté qu'à travers **trois écrans** : liste
  d'actifs, une étape de retrait, un tableau de bord. Il manque : écran de
  connexion, formulaire de réservation (aucun choix de `reservedUntil` visible
  alors que le scope l'exige explicitement), écran « Mon prêt », écran de
  retour, et tout écran d'anomalie côté technicien.
- L'étape de retrait affiche un bouton « Scanner le QR » sans montrer l'état
  réel de scan (caméra, permission refusée), ni les phases intermédiaires du
  `LockerOperationStatus` (`COMMAND_SENT`, `COMMAND_ACKNOWLEDGED`,
  `DOOR_OPENED`, `OBSERVATION_RECEIVED`) : la liste « Progression » ne compte
  que 3 puces génériques (réservation validée / preuve locale attendue /
  retrait confirmé), alors que `05-machines-a-etats.md` §5 distingue
  explicitement l'accusé de commande (`COMMAND_ACKNOWLEDGED`) de l'ouverture de
  porte et de l'observation physique — une distinction que le scope juge assez
  importante pour être nommée en toutes lettres (§9.8 : *« Ce n'est ni un
  accusé d'affichage du QR ni une preuve d'ouverture ou de mouvement
  d'actif »*).
- Aucun état `ANOMALY`, `FAILED` ou `EXPIRED` de `LockerOperation` n'est
  représenté nulle part, alors que ce sont des sorties obligatoires du
  parcours (§5.4 du document 05) et un critère d'acceptation du MVP (§18.17).
- Côté Web, la barre latérale liste « Actifs », « Prêts », « Anomalies »,
  « Audit », mais seule « Vue d'ensemble » est illustrée : aucun de ces écrans
  n'existe, y compris l'écran d'investigation d'anomalie que la persona
  administrateur doit pouvoir utiliser pour reconstruire un audit.

### 1.2 Hiérarchie

- Sur l'écran catalogue iOS, le badge de statut (cercle de 10 px + texte
  13 px) est visuellement plus discret que le titre de l'actif (19 px), alors
  que la persona technicien doit percevoir la readiness sans effort, dans la
  même zone de lecture que l'identité de l'actif (« unmistakable readiness »
  dans `SKILL.md`). L'identité reste proéminente; l'ordre exact est une
  hypothèse (H1, `sections.md` §1.2).
- Aucune carte bloquée ne dérive sa raison d'un gabarit commun alimenté par
  `ReadinessReason` : le texte « Calibration expirée » est de la prose libre,
  pas un gabarit cohérent avec les autres écrans. Le correctif est une
  traduction française stable de chaque raison, pas l'affichage du code brut
  dans le libellé principal (`sections.md` §1.3).
- Le tableau de bord Web place « Prêts actifs » (carte neutre) et le badge
  rouge « Anomalies · 1 » du menu latéral avec un poids visuel comparable :
  rien n'indique lequel des deux mérite l'attention immédiate de
  l'administrateur au premier regard.
- Le bandeau « Ouvrir le journal d'audit corrélé » a la même largeur et un
  poids proche de la carte d'anomalie juste au-dessus, alors qu'il s'agit
  d'une action secondaire de navigation, pas d'un signal d'état.

### 1.3 Composition

- Les items de la liste « Progression » (retrait) sont espacés de façon très
  serrée (cercles à y = 571/620/669, texte immédiatement à côté) : un
  `failureReason` réaliste et plus long que « Preuve locale attendue »
  provoquerait un retour à la ligne non testé — contraire à l'exigence de
  tester la copie française la plus longue réaliste
  (`visual-quality-bar.md`).
- Le même gabarit de carte (rectangle arrondi, bordure, badge coloré) sert à
  la fois à une cellule saine (A1) et, avec juste une palette différente, à
  une cellule en anomalie (A2) : deux significations très différentes
  (fonctionnement normal vs anomalie ouverte) partagent la même grammaire
  visuelle sans dispositif de groupement propre — un des cas explicitement
  cités par `design-workflow.md` (*« turns every datum into an interchangeable
  card »*).
- La barre latérale Web laisse un vide d'environ 260 px entre « Audit »
  (y = 464) et « Admin · Démo » (y = 728) : une zone vide disproportionnée
  pour une console qui doit rester dense.
- Les deux téléphones et le panneau Web sont alignés à la même hauteur
  (y = 150, hauteur 620) dans une planche unique : le panneau Web ne mesure
  que 574×620 px, soit à peine plus grand qu'un écran de téléphone. Cela
  encourage justement l'anti-pattern à éviter : un Web qui reste au niveau de
  densité d'un mobile plutôt que d'adopter un agencement dense, orienté
  clavier, avec tableau de données, filtres et vue maître-détail.

### 1.4 Identité visuelle

- Le fond utilise un `linearGradient` et un filtre `feDropShadow` sur les
  cadres sans justification liée à la hiérarchie ou au retour utilisateur —
  contraire à `visual-quality-bar.md` (*« Do not use gradients, glass
  effects, shadows, animation, or novelty typography without a reason »*).
- Les écrans iOS sont rendus en **mode clair** (fond `#F4F7FA`, cartes
  blanches) à l'intérieur d'un cadre sombre, alors que la légende de l'artefact
  revendique une « identité bleu nuit » commune. Le mobile et le Web
  n'illustrent donc pas la même identité — c'est une incohérence, pas un choix
  de thème assumé et documenté.
- Le bouton « Scanner le QR » et la puce de statut « Réservation validée »
  utilisent un bleu générique (#146EA8, #1E6FA8) que l'on retrouverait sur
  n'importe quel gabarit d'application mobile ; rien ne distingue
  visuellement Aegis d'un tableau de bord SaaS générique, ce que
  `SKILL.md` demande explicitement d'éviter.
- Aucun jeton sémantique n'est défini (couleurs de readiness, de sévérité, de
  connectivité), aucune règle typographique par rôle, aucune règle
  d'icône/étiquette de statut — rien de réutilisable pour la suite.

### 1.5 Contenu

- Le sous-titre « 2 actifs · Atelier principal » introduit un concept
  d'« atelier »/site non défini dans `02-scope.md` (le P0 est un seul locker,
  aucune notion multi-site n'existe avant le P2 — voir §13). C'est une
  invention de contenu hors périmètre, contraire à la règle « ne pas inventer
  d'états ou de contrats non déjà établis ».
- Le texte « Réservation indisponible » sur la carte bloquée est une étiquette
  générique, alors que le contrat REST expose un `ReadinessReason` structuré
  (`CALIBRATION_EXPIRED`) : le gabarit de contenu doit en dériver un libellé
  français traçable; le code lui-même reste réservé aux contextes techniques.
- Aucune date ni fuseau horaire n'est présentée de façon cohérente avec
  l'exigence du scope (`America/Toronto`, horaires d'exploitation) ; « 18 déc.
  2026 » et « le 8 septembre 2026 » utilisent deux formats différents dans la
  même planche sans règle déclarée.
- La copie la plus longue réaliste (raison de blocage détaillée, résumé
  d'anomalie, motif d'échec `failureReason`) n'est testée nulle part.

### 1.6 Adéquation à la plateforme

- **iOS :** le bas d'écran (« Équipements » / « Mon prêt ») est un simple
  texte sur deux colonnes, pas une vraie barre d'onglets native (`TabView`
  avec icônes SF Symbols) ; le bouton de scan est un rectangle plein plutôt
  que d'illustrer une feuille caméra native ; aucune indication de
  Dynamic Type, VoiceOver ou cible tactile minimale.
- **Web :** malgré un cadre desktop, le contenu reste au niveau d'un tableau
  de bord de synthèse — pas de tableau de données, pas de colonnes triables,
  pas de filtre, pas de recherche, pas de sélection multiple, pas d'indice de
  focus clavier. C'est visuellement un « mobile-style layout stretched wide »
  malgré son cadre large, l'exact anti-pattern à éviter pour la console
  d'administration.

---

## 2. Problème à résoudre

> Comment permettre à un technicien de confirmer en quelques secondes qu'un
> actif est prêt, conforme et autorisé pour lui — et de le retirer/retourner
> avec une preuve physique cohérente — pendant qu'un administrateur peut
> diagnostiquer la readiness, surveiller le casier et reconstruire la chaîne
> de possession d'un geste, sans jamais laisser une réservation, un QR affiché
> ou une simple pression sur un bouton se faire passer pour une action
> physique confirmée par le serveur ?

## 3. Utilisateurs

### 3.1 Technicien — iOS (`Aegis Mobile`)

- **Contexte physique :** atelier/laboratoire, souvent debout, parfois avec
  des gants ou les mains chargées, éclairage variable, réseau Wi-Fi ou
  cellulaire local, un seul locker à portée physique.
- **Objectif :** trouver rapidement le bon actif, savoir immédiatement s'il
  est utilisable, réserver, scanner le QR affiché sur le hub, obtenir une
  confirmation fiable du retrait/retour, connaître sa réservation et son prêt
  en cours.
- **Ce qui échoue si la conception est mauvaise :** un technicien croit avoir
  retiré un actif alors que le serveur n'a pas confirmé, ou ignore pourquoi un
  actif est bloqué et perd du temps à réessayer.

### 3.2 Administrateur — Web (`Aegis Manager`)

- **Contexte physique :** poste de travail fixe, clavier et souris, plusieurs
  onglets ouverts, séances parfois longues d'audit ou de configuration.
- **Objectif :** gérer catalogue et actifs, diagnostiquer une readiness
  bloquée, superviser réservations/prêts, surveiller le locker et ses portes,
  investiguer une anomalie, reconstruire un audit, effectuer une correction
  sûre (jamais une résolution manuelle d'anomalie sans preuve physique).
- **Ce qui échoue si la conception est mauvaise :** une anomalie critique se
  perd dans une liste dense, ou l'administrateur croit pouvoir « résoudre »
  une anomalie par un simple changement de statut (interdit par le domaine).

## 4. Contraintes

- **iOS natif obligatoire** pour le parcours technicien : SwiftUI, patrons et
  composants Apple HIG-appropriés, jamais un habillage web reskinné.
- **Web dense mais accessible** pour la console d'administration : agencement
  orienté clavier, table de données, filtres, vue maître-détail — pas un
  agencement mobile étiré.
- **Identité Aegis partagée** (marque, ton, terminologie, sémantique des
  statuts) sans skin identique entre plateformes : le sens doit être le même,
  la composition non.
- **Autorité serveur stricte** : aucune readiness n'est éditable côté client;
  une réservation ou un QR affiché n'ouvre jamais un compartiment par
  eux-mêmes ; le retrait/retour n'est confirmé qu'après preuve physique
  cohérente validée par le backend (§7.2–7.3, 9.8 de `02-scope.md`).
- **Terminologie P0 fermée** : readiness (`READY`/`BLOCKED`/`UNKNOWN`),
  disponibilité, calibration, réservation, prêt, `LockerOperation`, défi
  local, anomalie — tels que définis dans `03-dictionnaire-de-donnees.md` et
  `05-machines-a-etats.md`. Ne pas inventer d'état ou de concept
  supplémentaire (ex. « atelier », multi-site) qui n'existe pas dans le scope
  approuvé.
- **Toute copie française doit être réaliste et testée** aux longueurs
  réalistes (raisons de blocage, motifs d'échec, résumés d'anomalie), pas en
  `lorem ipsum` ni en texte factice.

## 5. Critères de succès observables (gate A)

Un humain doit pouvoir, sans expliquer le produit à voix haute :

1. identifier immédiatement où il se trouve dans le parcours (catalogue,
   détail, opération en cours, tableau de bord, table de données) ;
2. lire le statut de readiness/disponibilité/opération sans dépendre de la
   seule couleur ;
3. identifier l'action sûre suivante (réserver, scanner, retourner,
   accuser réception d'une anomalie) ;
4. distinguer une intention utilisateur (réservation créée, retrait demandé)
   d'une confirmation physique effective ;
5. reconnaître, sur Web, une anomalie ouverte et la chaîne de preuve
   nécessaire à sa résolution, sans pouvoir la résoudre manuellement.

## 6. Portée de ce livrable

Ce document couvre la Discovery et l'étape « directions visuelles » du mode
Prototype. Aucune haute fidélité, aucune implémentation, aucun transfert à
`web-engineer` ou `ios-engineer` n'a lieu ici. Voir `states.md` pour la
matrice d'états et `directions.md` pour les wireframes basse fidélité et les
directions visuelles concurrentes.
