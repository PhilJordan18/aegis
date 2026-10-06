# Aegis Manager — entrée, connexion et fondation visuelle : brief

Mode : Prototype, raffinement ciblé du traitement A « Verre lumineux »
(approuvé le 23 septembre 2026). Date : 30 septembre 2026. Plateforme : Web
(React, Aegis Manager). Autonomie accordée par Philippe pour cette passe : il
approuvera le résultat implémenté et rendu, pas ces documents.

Ce qui est déjà approuvé et n'est pas rediscuté ici : structure des sections
et §3 « Entrée — connexion » de `../asset-lifecycle/sections.md`, décisions
U1 à U8, traitement A, une institution par déploiement, aucune inscription
publique en P0 (`02-scope.md` §11.1). Ce qui ne l'est pas : la police Web, les
valeurs des jetons, les libellés marqués « proposé » dans `states.md`.

## Constat sur l'existant (traitement A, rendus `02-equipements.png`)

Ce qui tient :

- statut en tête de rangée et dossier dominant;
- barre latérale de verre détachée;
- profondeur bleu–indigo mesurée;
- bouton principal en dégradé;
- formulaires et données sur surfaces opaques.

Ce qui ne tient pas et est corrigé ici :

- **Police.** SF Pro n'est pas licenciable comme police Web; les rendus ne
  prouvent donc rien pour le produit.
- **Accès par la navigation.** Aucune entrée ni connexion n'a été dessinée.
  Les sections non construites n'ont pas de traitement : elles
  apparaîtraient cliquables et vides.
- **Mise en page.** Le nom du compte chevauchait le menu. L'aide du champ de
  date était rognée par le pied. Un grand vide restait sous la liste à deux
  éléments.
- **Signature.** Aucun élément propre à Aegis : sans le logo, l'écran
  ressemble à un tableau de bord générique en verre.

## Persona et contexte

- **Qui :** l'administrateur d'Aegis. Sur le marché de référence, c'est le
  responsable de maintenance, d'atelier ou de la qualité d'une équipe
  d'inspection. Au laboratoire, c'est un membre de l'équipe avec un compte
  préparé (« Administrateur Démo »).
- **Où :** poste de bureau ou portable, de 1280 à 1440 px, parfois une
  tablette. La page est aussi projetée pendant la démonstration.
- **Objectif :** arriver, comprendre en quelques secondes ce qu'est Aegis
  Manager, se connecter sans friction et, en cas d'échec, savoir exactement
  quoi faire.
- **Risques :**
  - un technicien se connecte au Manager;
  - une session expire pendant le travail, avec la crainte d'avoir
    interrompu un prêt;
  - un blocage anti-abus (5 essais par minute);
  - un service injoignable;
  - le zoom navigateur à 200 %;
  - un thème de contraste Windows.

## Travail principal de chaque écran

| Écran | Travail principal | Doit dominer |
|---|---|---|
| Accueil `/` | Comprendre la promesse P0 et se connecter | Le titre, la phrase de promesse, **Se connecter** |
| Connexion `/connexion` | Ouvrir une session avec un compte préparé | Le formulaire, puis l'état courant (erreur, expiration, blocage) |
| Shell + Équipements (aperçu) | Prouver que la typographie et les jetons tiennent en densité opérationnelle | Le diagnostic en tête de rangée, le dossier, la section courante |

## Contraintes

- **Contrat :** seules les routes `POST /api/v1/auth/login` et
  `GET /api/v1/auth/me` existent (`09` §10.2–10.3). Les codes d'erreur sont
  ceux du §21 et la limite de débit celle du §23.4. Le jeton Web reste en
  mémoire (§4.2).
- **Portée :** ni création de compte, ni récupération autonome du mot de
  passe, ni choix d'institution, ni libellé d'institution avant la connexion
  (C6).
- **Honnêteté :**
  - aucune métrique, aucun logo client, aucun témoignage, aucune
    certification;
  - le laboratoire est un terrain de validation, pas un client;
  - toute donnée illustrative est marquée.
- **Accessibilité :** WCAG 2.2 AA mesuré sur le fond rendu, 320 px sans
  défilement horizontal, zoom à 200 %, `forced-colors`,
  `prefers-reduced-transparency`, `prefers-reduced-motion`.

## Critères de réussite (observables sur l'implémentation)

1. En cinq secondes sur l'accueil, on sait ce qu'est Aegis Manager et où se
   connecter.
2. Chaque état de connexion du tableau de `states.md` est reproductible avec
   le sélecteur d'aperçu. Son texte, son focus et son annonce correspondent à
   la spécification.
3. Un compte technicien n'a accès à aucune donnée du Manager et sait où
   aller.
4. Le shell montre la section courante et les sections à venir sans lien
   mort.
5. Tous les rendus passent à 1440, 1280, 768, 390 et 320 px, en clair, en
   sombre et en couleurs forcées, sans chevauchement ni débordement.
6. Les contrastes mesurés sur le fond rendu atteignent au moins 4,5:1 pour
   le texte et 3:1 pour les éléments d'interface.

## Direction visuelle (sept points, `visual-quality-bar.md`)

1. **Utilisateur et contexte :** administrateur au bureau ou en
   démonstration projetée; attention partagée, besoin de confiance.
2. **Travail principal :** entrer dans le Manager et comprendre toute
   situation de connexion sans ambiguïté.
3. **Qualité émotionnelle :** calme, précise, digne de confiance, haut de
   gamme sans ostentation. Un instrument, pas une vitrine.
4. **Information dominante :**
   - accueil : la promesse (« Autorisé. Observé. Tracé. ») et **Se
     connecter**;
   - connexion : l'état courant;
   - Manager : diagnostic et section courante.
5. **Signature :** la *cellule attendue*. Une grille retenue de
   compartiments à fins contours, dont **une seule cellule est allumée**
   (lumière blanche vers bleu, halo indigo). Elle traduit la garantie
   centrale d'Aegis : seule la cellule attendue s'ouvre. Déclinaisons :
   - une cellule allumée dans l'atmosphère de l'accueil;
   - une cellule qui luit derrière le bord du panneau de connexion;
   - un repère lumineux sur la section courante de la barre latérale;
   - une cellule vide en tirets pour une section à venir;
   - le monogramme, un carré à quatre cellules dont une allumée.

   Règle : **une seule lumière par vue**. La signature ne porte jamais d'état
   métier.
6. **Accessibilité :**
   - la grille est décorative (`aria-hidden`) et disparaît en transparence
     réduite et en couleurs forcées;
   - le texte ne repose jamais sur le verre ou le dégradé sans surface
     stable;
   - statuts et alertes combinent symbole, forme et texte;
   - mouvement de 240 ms au plus, supprimé en mouvement réduit.
7. **Ce que le design évite :**
   - un fluide multicolore, du verre derrière les formulaires;
   - une animation d'intro, un défilement détourné, un compteur décoratif;
   - des chiffres inventés, des logos, des témoignages;
   - « Créer un compte »;
   - une copie de la mise en page noir et blanc de Next.js.

## Références et principe retenu

Principes seulement : aucun actif, marque, mise en page ni texte n'est repris.

| Référence | Principe transposé |
|---|---|
| https://nextjs.org | Contraste quasi noir et blanc du texte; très grand titre compact à approche serrée (−0,045 em); gris secondaire retenu; lignes de structure fines (bande des cinq garanties); détail en chasse fixe (surtitres, numéros 01–05); marges disciplinées. Écart assumé : une seule action principale au lieu de deux, et Geist est aussi la police de Vercel (voir `typographie/typographie.md`). |
| https://definedvc.com | Fond atmosphérique vif et panneau calme et opaque qui porte le texte : c'est la composition de la connexion. Transposé en profondeur bleu–indigo et en lumière contrôlée (une source), jamais en fluide multicolore. |
| https://landonorris.com | Typographie éditoriale assurée, par contraste d'échelle (72 px contre 17 px) et de graisse; lignes fines. Très atténué : aucun mouvement d'entrée, aucun défilement détourné, aucune transition au-delà de 240 ms. |

## Artefacts de cette passe

| Fichier | Rôle |
|---|---|
| `states.md` | Parcours et matrice des états de connexion, avec les textes |
| `typographie/typographie.md` et `typographie/specimen*.{html,png}` | Comparaison Geist / Inter et choix |
| `wireframes/*.png` et `wireframes/wireframes.html` | Filaires basse fidélité |
| `tokens.css` | Jetons proposés (source unique) |
| `reference/reference.html` et `reference/renders/*.png` | Rendu de référence des jetons, non normatif |
| `handoff.md` | Spécification d'implémentation |
| `proposition-inscription.md` | Proposition d'inscription (décision en attente, hors implémentation) |
| `captures/` | Captures de l'implémentation, produites par l'outillage du web-engineer |
