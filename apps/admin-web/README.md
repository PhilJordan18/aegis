# Aegis Manager — administration Web

Application React/TypeScript des administrateurs (ADR-010). Cette première
tranche couvre l'accueil, la connexion avec tous ses états, le shell
d'Aegis Manager et un aperçu statique de l'écran Équipements. Elle ne se
connecte pas encore à l'API.

Le rendu applique le handoff de conception (`docs/design/manager-entree/` :
`handoff.md`, `tokens.css`, `states.md`, `reference/`). Il n'invente aucune
direction visuelle. Les textes [P] et les jetons restent **proposés** tant
que Philippe n'a pas approuvé le rendu.

## Commandes

Node 22.12 ou plus récent (vérifié avec Node 24.13 et npm 11.8).

```bash
npm install
npm run dev            # serveur Vite, aperçu de conception actif
npm run typecheck      # TypeScript strict (tsc -b)
npm run lint           # ESLint
npm test               # Vitest : tests unitaires et de composants (jsdom)
npm run test:watch
npm run build          # typecheck, build de production, puis vérification qu'aucun code d'aperçu n'y figure
npm run build:preview  # build de revue avec l'aperçu (dist-preview/), jamais déployé
npm run preview        # sert dist/
npm run test:a11y      # Playwright : axe (WCAG 2.x A/AA), absence de défilement horizontal et parcours, sur toute la matrice
npm run capture        # mêmes contrôles, et écrit la matrice complète dans test-results/captures/ (ignoré par Git)
npm run capture:evidence  # 16 captures choisies, à 1×, dans docs/design/manager-entree/captures/
```

Ces trois commandes Playwright démarrent leur propre serveur Vite sur
`127.0.0.1:5180`. Ils utilisent le Chromium de Playwright 1.63 déjà installé
(`npx playwright install chromium` s'il manque). Pour filtrer les cas :
`npm run capture -- --grep connexion`. Les captures sont faites en mouvement
réduit par défaut; `AEGIS_MOTION=no-preference` le désactive.

`capture:evidence` est le seul outil qui écrit hors de `apps/admin-web`, et
uniquement dans `docs/design/manager-entree/captures/`. Les fichiers sont
nommés `<route>-<état>-<taille>-<thème>.png`.

- **Tailles :**
  - `desktop` (1440×900), `laptop` (1280×800), `mobile` (390×844), `reflow`
    (320×720);
  - `zoom200` : fenêtre de 1280×800 à 200 %, soit 640×400 px CSS.
- **Thèmes :**
  - `light` et `dark` suivent le système;
  - `forced-dark` et `forced-light` imposent la préférence contraire au
    système;
  - `forced-colors` émule les couleurs forcées.
  - Les trois derniers sont capturés en `desktop` seulement.

Une capture est prise avant les contrôles, pour qu'un état en échec laisse
une trace. Les parcours (`flow:`) vérifient en outre :

- l'ordre de tabulation et le focus après connexion;
- l'écran de mauvais rôle, sans aucune requête;
- le sélecteur d'aperçu;
- l'apparence appliquée avant le premier affichage;
- le stockage, qui ne contient que la préférence;
- les polices servies par le bundle, sans CDN;
- la transparence réduite (émulée par CDP) et le mouvement réduit;
- le tiroir modal et le lien d'évitement.

## Dépendances

| Paquet | Raison |
|---|---|
| `react`, `react-dom` | Pile approuvée. |
| `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` 5.3.0 | Polices du handoff (§1, `typographie/typographie.md`), licence OFL 1.1 incluse. Auto-hébergées par Vite, sans CDN. Seul le sous-ensemble latin est déclaré (`src/styles/fonts.css`) : il couvre le français. Deux fichiers woff2, 29,4 Ko et 23,1 Ko. |
| `vite`, `@vitejs/plugin-react` | Pile approuvée : serveur de développement et build. |
| `typescript` ~6.0 | Pile approuvée. Épinglé sous 6.1 car `typescript-eslint` 8.71 n'accepte pas encore TypeScript 7. |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` | Configuration ESLint historique du gabarit Vite react-ts. Le gabarit actuel propose oxlint; ESLint a été conservé à la demande. |
| `vitest`, `jsdom` | Tests unitaires et de composants, avec la configuration de Vite. |
| `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` | Tests par rôles et libellés accessibles, et interactions clavier réalistes. |
| `@playwright/test` 1.63.0 | Rendu réel pour les captures et les parcours clavier. Version alignée sur le navigateur déjà installé. |
| `@axe-core/playwright` | Contrôles automatiques WCAG A/AA sur le rendu. |
| `@types/*` | Types de React et de Node. |

Pas encore de TanStack Query : aucune donnée serveur n'est lue dans cette
tranche. Il sera ajouté avec l'intégration de l'API. Aucun kit d'interface,
aucun framework CSS, aucune bibliothèque d'icônes.

## Couche visuelle

- `src/styles/tokens.css` reprend mot pour mot
  `docs/design/manager-entree/tokens.css`. `src/styles/tokens.test.ts`
  échoue si les deux fichiers divergent : modifier d'abord le fichier de
  conception.
- `src/styles/base.css` contient la réinitialisation, l'anneau de focus et
  le verre avec ses trois replis opaques : absence de `backdrop-filter`,
  `prefers-reduced-transparency` et `forced-colors`. Le décor y est masqué
  dans ces cas, et toute transition est coupée en mouvement réduit.
- Chaque composant a sa feuille CSS simple, avec des classes `ag-*` et ses
  règles de couleurs forcées (handoff §9.5) :
  - `src/ui/` : marque, bouton, alerte, pastille de statut, icônes SVG en
    ligne, cellules;
  - `src/app/shell/` : barre latérale, menu du compte, tiroir;
  - `src/pages/`;
  - `src/features/auth/sign-in.css`.
- Le verre est réservé à la navigation : barre latérale, onglets, barre
  compacte. Formulaires, alertes et données reposent sur `--ag-surface`.

## Ce qui relève de l'aperçu uniquement

L'aperçu de conception est compilé seulement sur le serveur de développement
ou avec `VITE_AEGIS_PREVIEW=true` (`build:preview`, `.env.preview`). Vite
remplace alors `__AEGIS_PREVIEW__` par une valeur littérale. Un build de
production élimine donc ces modules avant le découpage en fichiers.
`scripts/check-preview-excluded.mjs` échoue si la marque `aegis-preview-only`
apparaît dans `dist/`. `build:preview` vérifie au contraire qu'elle est
présente, pour prouver que le contrôle détecte bien le code d'aperçu.

Fichiers de l'aperçu :

- `src/features/auth/previewAuthGateway.ts` retourne l'issue choisie par le
  scénario. Il ne vérifie aucun identifiant, n'appelle aucune API et renvoie
  un jeton manifestement factice (`aegis-preview-only:not-a-token`). Seul
  l'état `envoi` reste en attente, jusqu'à l'annulation;
- `src/preview/EquipmentPreviewPage.tsx` affiche l'écran Équipements avec des
  données fictives;
- `src/preview/PreviewStrip.tsx` est la bande « Mode aperçu », dans le
  flux en haut du document. Ses sélecteurs « État » et « Thème » changent
  l'état affiché et l'apparence. Un état de résultat soumet une fois des
  valeurs fictives par le vrai formulaire;
- `src/preview/previewRuntime.ts` gère la sélection de scénario : paramètre
  `?apercu=<scénario>` sur `/connexion`, et API `PreviewControls`. Une
  valeur inconnue est ignorée. Les scénarios
  d'arrivée (`session-expiree`, `session-invalide`, `deconnecte`) passent par le vrai
  magasin de session, comme le ferait un 401.

Scénarios de connexion : `inactif`, `envoi`, `identifiants-refuses`,
`trop-de-tentatives`, `service-injoignable`, `erreur-service`, `validation`,
`role-non-autorise`, `connecte`, `session-expiree`, `session-invalide`,
`deconnecte`.

En aperçu, chaque page affiche la bande « Mode aperçu — aucune connexion
réelle, données fictives ». L'écran Équipements ajoute la barre « Aperçu
visuel », qui décrit ses actions inactives (`aria-disabled`). Hors aperçu,
la connexion répond « Connexion au service impossible. ». C'est exact :
aucun adaptateur HTTP n'existe encore.

## Routage

`src/app/routes.ts` et `src/app/router.ts` forment une interface
**volontairement minimale**, fondée sur l'API History et sans dépendance. Elle
sera remplacée par le routeur choisi à l'intégration.

| Route | Page |
|---|---|
| `/` | Accueil (textes [P] du handoff §7) |
| `/connexion` | Connexion |
| `/apercu/equipements` | Aperçu seulement; « Page introuvable » ailleurs |
| autre | Page introuvable |

- `<html lang="fr-CA">` (handoff §7) et un titre par route.
- Lien d'évitement vers `#contenu` en tête du shell.
- Après une navigation, le focus passe au `h1` de la page; au premier
  chargement, il n'est pas déplacé.
- La connexion suit ses propres règles de focus (`states.md` §3).

## Apparence

Les choix sont Système (par défaut), Clair et Sombre (U7, `sections.md`
§5.7). La préférence est gardée dans `localStorage` sous
`aegis.manager.appearance`. C'est une préférence d'interface, jamais un
jeton. Elle est lue prudemment : erreurs de stockage tolérées, valeurs
invalides ignorées.

Un script dans `index.html` l'applique avant le premier affichage, sur
`<html>` : `data-theme` (`light` ou `dark`, thème effectif), `data-appearance`
(la préférence) et `color-scheme`. Un test vérifie qu'il donne le même
résultat que `src/features/appearance/appearance.ts`. Une future
Content-Security-Policy devra l'autoriser par empreinte.

## Authentification : contrat et points d'intégration

- `features/auth/contract.ts` reprend les types du document 09 (§4, §7,
  §10.2–10.3, §21).
- `features/auth/authGateway.ts` définit l'interface `AuthGateway` et décrit
  les responsabilités de l'adaptateur HTTP à venir.
- `features/auth/signInOutcome.ts` associe, par une fonction pure, chaque
  résultat à un état de l'interface.
  - `invalidCredentials` : 401 `AUTH_INVALID_CREDENTIALS`.
  - `rateLimited` : 429, avec `Retry-After` en secondes ou en date HTTP.
  - `unreachable` : panne réseau, délai dépassé, ou 5xx sans corps
    utilisable.
  - `validation` : 400 `VALIDATION_ERROR`, avec les violations par champ.
  - `unauthorizedRole` : connexion réussie d'un compte non `ADMIN`; le jeton
    est jeté et aucune donnée n'est chargée (U6).
  - `serviceError` : réponse non prévue par le contrat de connexion (5xx
    avec corps problem+json, 403, code inattendu). Le `traceId` est conservé
    pour le support.
  - `signedIn`.
  - Motifs d'arrivée : `sessionExpired` (401 `AUTH_TOKEN_EXPIRED`),
    `sessionInvalid` (401 `AUTH_TOKEN_INVALID`, ou 401 sans code) et
    `signedOut` (après « Se déconnecter »).
- `features/auth/session.ts` est le magasin de session **en mémoire**
  (ADR-007, 09 §4.2). Rien n'est écrit dans localStorage, sessionStorage,
  les cookies ou IndexedDB : recharger la page impose de se reconnecter. Le
  jeton est absent de l'état lu par React. Il refuse une session autre
  qu'administrateur.
- `features/auth/SignInPage.tsx` applique la matrice de `states.md` §3 :
  - zone d'alerte unique (`role="alert"` pour les erreurs, `role="status"`
    pour l'information) et cible de focus propre à chaque état;
  - pendant l'envoi : bouton occupé avec `aria-disabled` et champs en
    lecture seule;
  - délai abandonné après 15 s;
  - compte à rebours `Retry-After` placé hors de la région annoncée;
  - écran de mauvais rôle qui remplace le formulaire;
  - validation client sans requête;
  - le `title` et le `detail` du serveur ne sont jamais affichés : seuls le
    `code`, `violations[].field` et le `traceId` servent.
- Textes : `features/auth/signInCopy.ts` sépare les libellés approuvés [A]
  des libellés proposés [P] (`states.md`). La validation est dans
  `signInValidation.ts`.
- `features/auth/session.ts` garde aussi en mémoire le courriel d'une
  session terminée par un 401, pour préremplir le formulaire.

### À ajouter à l'intégration

1. Un adaptateur HTTP de `AuthGateway` : `POST /api/v1/auth/login`,
   `GET /api/v1/auth/me` avec `Authorization: Bearer`, analyse de
   problem+json, `Retry-After`, `X-Request-Id`/`traceId`, délai et
   annulation.
2. TanStack Query pour l'état serveur (profil, puis données
   administratives), avec clés de requête centralisées.
3. Côté API : CORS limité à l'origine exacte du Manager, par environnement
   (09 §23.1). Ce n'est pas encore configuré.
4. Le traitement global des 401, qui appelle `session.end(...)` puis mène à
   `/connexion`, et le `returnTo` interne validé (`states.md` §1). Il
   n'existe pas encore : aucune route protégée n'existe dans cette tranche.
