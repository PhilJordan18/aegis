# Aegis Manager — administration Web

Application React/TypeScript des administrateurs (ADR-010). Elle couvre
l'accueil, la connexion avec tous ses états, le shell d'Aegis Manager et un
aperçu statique de l'écran Équipements (WEB-00). Depuis WEB-01, la connexion
et la session passent par l'API (`POST /api/v1/auth/login`,
`GET /api/v1/auth/me`) hors du mode aperçu.

Le rendu applique l'identité « Lumière du hub » v3 approuvée par Philippe
(issue #79 : `docs/design/manager-v3/`, référence commune dans
`docs/design/identite/reference.md`) sur les parcours, les états et les textes
du handoff d'entrée (`docs/design/manager-entree/` : `handoff.md`, `states.md`).
Il n'invente aucune direction visuelle. Les textes [P] restent **proposés** tant
que Philippe ne les a pas approuvés.

## Commandes

Node 22.12 ou plus récent (vérifié avec Node 24.13 et npm 11.8).

```bash
npm ci --ignore-scripts   # installation reproductible; aucune dépendance n’a de script d’installation
npm run dev            # serveur Vite, aperçu de conception actif
npm run dev:api        # serveur Vite sans aperçu : /api est relayé vers l'API locale
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
npm run capture:integration  # 14 captures FR/EN de l'identité v3, à 1×, dans docs/design/manager-v3/captures-integration/
npm run test:identity  # mesures sur le rendu : saut de mise en page, contrastes peints, focus, texte coupé
npm run test:e2e:api   # recette Playwright contre l'API réelle (build de production); échoue sans API ou sans identifiants
```

### Développer contre l'API

Les serveurs Vite (`dev`, `dev:api`, `preview`) relaient `/api` vers
`http://127.0.0.1:8080` (`AEGIS_API_ORIGIN` le remplace). Le navigateur reste
sur sa propre origine : aucun CORS n'est nécessaire en local, et seule l'API
est jointe, jamais PostgreSQL ni MQTT.

1. Lancer l'API avec les comptes de démonstration
   (`services/api/README.md`, « Pour lancer l'API »).
2. `npm run dev:api`, puis ouvrir `/connexion`. `npm run dev` garde l'aperçu
   de conception et n'appelle jamais l'API.

`npm run test:e2e:api` construit le build de production, le sert avec
`vite preview` sur `127.0.0.1:5181` et vérifie, contre l'API :

- la connexion de l'administrateur jusqu'au shell, avec `GET /auth/me`;
- l'absence de tout jeton dans le stockage, puis la déconnexion;
- le refus du compte technicien, sans requête après la connexion;
- un compte inconnu (401), une violation serveur (400) et la limite de débit
  (429 avec `Retry-After`).

Il lit `AEGIS_DEMO_ADMIN_PASSWORD` et `AEGIS_DEMO_TECHNICIAN_PASSWORD`, les
mêmes variables que l'API (courriels : `AEGIS_DEMO_ADMIN_EMAIL` et
`AEGIS_DEMO_TECHNICIAN_EMAIL`, par défaut ceux de la démonstration). C'est une
commande de recette : sans ces variables, elle échoue avant toute
construction; sans API joignable, elle échoue dès la mise en place globale.
Aucun test n'y est ignoré, donc une exécution réussie signifie que les cinq
scénarios ont réellement passé contre l'API. Les contrôles hors ligne restent
`npm test` et les autres projets Playwright, qui ne chargent pas cette
configuration. Les mots de passe ne sont jamais écrits dans un fichier ni
affichés.

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

- l'ordre de tabulation (marque, « Accueil », langue, courriel) et le focus après connexion;
- l'écran de mauvais rôle, sans aucune requête;
- le sélecteur d'aperçu;
- l'apparence appliquée avant le premier affichage;
- le stockage, qui ne contient que les préférences d'interface (apparence,
  langue) et seulement après un choix explicite;
- les polices servies par le bundle, sans CDN;
- l'absence de verre (aucun `backdrop-filter`) et le mouvement réduit;
- le tiroir modal et le lien d'évitement.

`e2e/entry.spec.ts` tourne en français (la langue du navigateur est `fr-CA`
dans la configuration). `e2e/language.spec.ts` refait la matrice en anglais
(`en-CA`; 5 tailles, thèmes clair et sombre, tous les états de connexion, le
shell et la page introuvable : axe, défilement horizontal, `lang`, titre, aucun
chemin de clé visible, aucun texte français hors aperçu) et vérifie les parcours
de langue : préférence du navigateur, repli, choix mémorisé qui l'emporte,
changement au clavier, rechargement, menu du compte, tiroir et lien
d'évitement en anglais. `npm run test:a11y` et `npm run capture` incluent les
deux fichiers.

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
| `@tanstack/react-query` 5.104.1 | Pile approuvée (skill `aegis-react-admin`) pour l'état serveur : cache, annulation par `signal`, nouvel essai limité aux pannes réseau et aux 5xx, rafraîchissement au retour sur la fenêtre. Version exacte. Clés centralisées dans `src/api/queryKeys.ts`. |

Aucun kit d'interface, aucun framework CSS, aucune bibliothèque d'icônes,
aucun client HTTP : `fetch` suffit.

Aucune dépendance n'a été ajoutée pour la localisation (#78) : `Intl`
(`PluralRules`, `NumberFormat`, `DateTimeFormat`), présent dans tous les
navigateurs ciblés, couvre les pluriels, les unités et les dates en `fr-CA` et
`en-CA`. Une bibliothèque (`react-intl`, `i18next`) n'aurait ajouté que du
poids et un format de message à apprendre pour deux langues et une quarantaine
de messages; le typage TypeScript des catalogues apporte déjà la vérification
des clés et des paramètres.

## Couche visuelle

- `src/styles/tokens.css` porte les palettes sémantiques de la référence
  d'identité (clair minéral, sombre profond) et les jetons adoptés par Philippe :
  bordure des contrôles, anneau de focus plein de 2 px décalé de 2 px, élément
  sélectionné, contrôle désactivé; l'information est un bleu azur distinct du
  succès, de l'avertissement, de l'erreur et de l'accent. Il remplace pour
  l'entrée les jetons « Verre lumineux » de `docs/design/manager-entree/tokens.css`
  (conservé comme historique). `src/styles/tokens.test.ts` mesure le contraste de
  chaque paire qui porte du texte, un contrôle ou le focus, dans les deux
  apparences; `src/styles/identity.test.ts` échoue si du verre, des cellules, de
  l'indigo ou un dégradé de surface reviennent dans les sources de production.
- `src/styles/base.css` contient la réinitialisation, l'anneau de focus (le halo
  translucide ne l'accompagne que sur un champ) et la coupure des transitions en
  mouvement réduit. Aucune surface n'utilise `backdrop-filter`.
- Marque : un composant unique, `src/ui/Brand.tsx`. Le symbole vient des deux
  fichiers de `src/assets/brand/` (clair et sombre, copiés de
  `docs/design/identite/assets/`, voir leur `README.md`), choisis par `data-theme`;
  le mot « aegis » est composé en Geist et « Manager » est du texte, qui passe sur
  une seconde ligne sous 480 px au lieu de disparaître. Remplacer les deux
  fichiers suffit pour les assets définitifs. `src/ui/BrandPromise.tsx` porte la
  signature commune, l'accroche et la description (catalogues, `brand.*`).
- Chaque composant a sa feuille CSS simple, avec des classes `ag-*` et ses
  règles de couleurs forcées (handoff §9.5) :
  - `src/ui/` : marque, promesse de marque, bouton, alerte, pastille de statut,
    icônes SVG en ligne;
  - `src/app/shell/` : barre latérale, menu du compte, tiroir;
  - `src/app/page.css` : cadre et titre de page dans le shell, communs à
    l'Équipements protégé et à l'aperçu;
  - `src/pages/`;
  - `src/features/auth/sign-in.css`.
- Surfaces opaques et filets; la seule lumière est un halo radial localisé
  derrière la promesse (accueil, connexion), jamais derrière la carte ou un
  message. Les erreurs globales de connexion sont annoncées sous le bouton, dans
  une zone réservée au bas du formulaire : elles ne déplacent ni un champ ni le
  bouton.

## Ce qui relève de l'aperçu uniquement

L'aperçu de conception est compilé seulement sur le serveur de développement
(sauf `dev:api`, `.env.api`, qui pose `VITE_AEGIS_PREVIEW=false`) ou avec
`VITE_AEGIS_PREVIEW=true` (`build:preview`, `.env.preview`). Vite
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
la passerelle HTTP (`features/auth/httpAuthGateway.ts`) remplace la
passerelle d'aperçu, et l'Équipements protégé (`/equipements`) remplace
l'aperçu statique.

## Routage

`src/app/routes.ts` et `src/app/router.ts` forment une interface
**volontairement minimale**, fondée sur l'API History et sans dépendance. Elle
sera remplacée par le routeur choisi à l'intégration.

| Route | Page |
|---|---|
| `/` | Accueil (textes [P] du handoff §7) |
| `/connexion` | Connexion |
| `/equipements` | Équipements, protégé : session administrateur exigée, sinon `/connexion`. Arrivée après la connexion hors aperçu |
| `/apercu/equipements` | Aperçu seulement; « Page introuvable » ailleurs |
| autre | Page introuvable |

- `<html lang>` (`fr-CA` ou `en-CA`, handoff §7) et un titre par route, tous
  deux dans la langue choisie (voir « Langue »). Les chemins (`/connexion`,
  `/equipements`) restent français dans les deux langues : ce sont des adresses
  stables, pas des textes.
- Lien d'évitement vers `#contenu` en tête du shell.
- Après une navigation, le focus passe au `h1` de la page; au premier
  chargement, il n'est pas déplacé.
- La connexion suit ses propres règles de focus (`states.md` §3).

## Langue

Français et anglais (#78), selon `docs/localisation/convention.md` et
`docs/localisation/glossaire.md`. Le français est la langue de référence et de
repli; les textes anglais sont des propositions à valider.

- **Résolution** (`src/i18n/locale.ts`), dans l'ordre : le choix explicite
  gardé dans `localStorage` sous `aegis.manager.language` (`fr` ou `en`, rien
  d'autre); sinon la première langue de `navigator.languages` dont la langue
  principale est `fr` ou `en` (`fr-FR` donne le français, `fil` rien); sinon le
  français. Le stockage est lu et écrit prudemment, comme l'apparence : une
  erreur est tolérée et le choix s'applique alors pour la page. Rien n'est
  écrit tant que l'utilisateur ne choisit pas, et rien n'est envoyé au serveur.
- **Format** : `fr-CA` ou `en-CA` (`FORMAT_LOCALE`), quel que soit la variante
  du navigateur. `<html lang>` prend la même valeur, à la création du
  contrôleur (avant le premier rendu) puis à chaque changement; le titre du
  document suit la route et la langue (`pageTitle`).
- **Sélecteur** « Français / English » (`features/language/LanguageSwitch.tsx`) :
  groupe de boutons radio natifs, même contrôle segmenté que l'apparence,
  appliqué aussitôt. Chaque option est écrite dans sa langue avec son attribut
  `lang`, sans drapeau. Version compacte (légende masquée visuellement, qui
  reste le nom accessible du groupe) dans l'en-tête de l'accueil, de la
  connexion et de la page introuvable; version complète dans le menu du compte
  et le tiroir du shell.
- **Catalogues** (`src/i18n/messages/`) : `fr.ts` fixe la forme; `en.ts` est
  typé `Messages = typeof fr`, donc une clé manquante, en trop ou un paramètre
  différent échoue à `tsc`. Un message est une chaîne ou une fonction à
  paramètres nommés (`rateLimitedBody({ duration })`), une phrase complète à la
  fois, jamais assemblée; les valeurs (durée, date) sont formatées avant
  d'être insérées. Les pluriels passent par `createPluralSelector`
  (`Intl.PluralRules`, `i18n/plural.ts`) et les durées, horloges et dates par
  `i18n/format.ts` (`Intl.NumberFormat` avec l'unité `second`,
  `Intl.DateTimeFormat` avec un fuseau explicite). Les composants lisent
  `const { m, format } = useI18n()`.
- **Erreurs** : l'affichage vient du code (outcome de connexion, code de
  violation), jamais du `title` ni du `detail` du serveur. Les erreurs de champ
  et les annonces de la zone `status` sont gardées comme des codes et traduites
  au rendu : changer de langue les met à jour sur place. Un code inconnu donne le
  message générique et le `traceId`, affiché tel quel après sa phrase
  d'introduction (qui lui sert de libellé).
- **Ce qui n'est pas traduit** : les noms de produits (Aegis, Aegis Manager),
  les codes, les identifiants (`traceId`), le contenu de démonstration de
  l'accueil (« Multimètre 2 », `MM-002`, donnée saisie) et les chemins d'URL.
- **Couverture** : accueil, connexion et tous ses états, shell (navigation,
  menu du compte, tiroir, lien d'évitement), sélecteur d'apparence, page
  `/equipements` protégée et page introuvable. L'**aperçu de conception**
  (`src/preview/**`, hors build de production) reste en français : sa bande
  « Mode aperçu » et le contenu de l'écran Équipements d'aperçu ne sont pas
  traduits, seul le shell qui les entoure suit la langue. Il n'est donc pas
  bilingue.
- **Nouvel écran** : ajouter les textes dans `fr.ts` et `en.ts` dans le même
  changement; un nouveau terme métier passe d'abord par le glossaire. Le test
  `src/i18n/messages/catalog.test.ts` vérifie les mêmes clés, les mêmes
  paramètres, l'absence de texte vide ou qui ressemble à un chemin de clé.

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
- `features/auth/authGateway.ts` définit l'interface `AuthGateway` et les
  responsabilités de tout adaptateur.
- `features/auth/httpAuthGateway.ts` est l'adaptateur de production, sur
  `src/api/http.ts` :
  - `POST /api/v1/auth/login` avec exactement `email` et `password`;
    `GET /api/v1/auth/me` avec `Authorization: Bearer`;
  - même origine, `credentials: 'omit'`, `cache: 'no-store'`, un
    `X-Request-Id` UUID v4 par requête;
  - délai de 15 s et annulation par `signal`;
  - corps 2xx validé (`contractParsers.ts`); un corps hors contrat donne
    `invalidResponse`, jamais une session;
  - problem+json validé (`src/api/problem.ts`), sinon `problem: null`;
    `Retry-After` et `X-Request-Id` transmis tels quels;
  - aucun journal : ni mot de passe, ni jeton, ni corps.
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
    avec corps problem+json, 403, code inattendu, ou 2xx hors contrat). Le
    `traceId` (sinon le `X-Request-Id`) est conservé pour le support.
  - `signedIn`.
  - Motifs d'arrivée : `sessionExpired` (401 `AUTH_TOKEN_EXPIRED`),
    `sessionInvalid` (401 `AUTH_TOKEN_INVALID`, ou 401 sans code) et
    `signedOut` (après « Se déconnecter »).
- `features/auth/session.ts` est le magasin de session **en mémoire**
  (ADR-007, 09 §4.2). Rien n'est écrit dans localStorage, sessionStorage,
  les cookies ou IndexedDB : recharger la page impose de se reconnecter. Le
  jeton est absent de l'état lu par React. Il refuse une session autre
  qu'administrateur.
- Expiration (09 §4.1 : 60 min, sans refresh) : la session se termine seule
  en `sessionExpired` quand `expiresIn` secondes se sont écoulées depuis la
  réception de la réponse de connexion. Compter depuis la réception, et non
  comparer `expiresAt` à l'horloge du navigateur, rend l'échéance
  insensible à une horloge décalée. Le serveur reste l'autorité : tout 401
  antérieur termine la session aussi.
- `features/auth/authorizedRequest.ts` porte chaque appel protégé :
  - un 401 termine la session avec le motif du serveur
    (`AUTH_TOKEN_EXPIRED` → `sessionExpired`, sinon `sessionInvalid`);
  - une réponse tardive pour un ancien jeton ne termine jamais la session
    suivante.
  - `fetchCurrentAdminProfile` (`GET /auth/me`) termine aussi la session en
    `sessionInvalid` sur un 403 ou un profil qui n'est plus `ADMIN` : le
    serveur relit le compte à chaque requête (09 §4.1).
- `app/RequireAdminSession.tsx` protège `/equipements`. Sans session
  (jamais connecté, rechargement, déconnexion, expiration, 401), il remplace
  l'entrée d'historique par `/connexion`, qui affiche le motif d'arrivée.
- État serveur (TanStack Query) :
  - `src/api/serverState.ts` crée le client : nouvel essai, deux au plus,
    seulement pour une panne réseau ou un 5xx, jamais pour un 4xx ni une
    mutation;
  - `clearCacheOnSessionChange` vide tout le cache à chaque changement de
    jeton;
  - `useCurrentAdminProfile` lit `GET /auth/me` à l'entrée de la zone
    protégée, avec 5 min de fraîcheur;
  - le shell affiche d'abord le profil de la réponse de connexion, puis
    celui confirmé par `/auth/me`.
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
- Textes : le groupe `signIn` des catalogues (`src/i18n/messages/`, voir
  « Langue ») marque en commentaire les libellés approuvés [A]; les autres sont
  proposés [P] (`states.md`). La validation (`signInValidation.ts`) renvoie des
  codes d'erreur de champ, que la page traduit au rendu.
- `features/auth/session.ts` garde aussi en mémoire le courriel d'une
  session terminée par un 401, pour préremplir le formulaire.

### Reste à faire

1. **Service en production.** Le Manager appelle `/api` sur sa propre
   origine. Le déploiement doit soit servir `dist/` et relayer `/api` par le
   même hôte (proxy inverse, sans CORS), soit configurer côté API un CORS
   limité à l'origine exacte du Manager (09 §23.1). Ni l'un ni l'autre
   n'existe encore.
2. **`returnTo`** (`states.md` §1, Q5) : après une reconnexion, le Manager
   va toujours à `/equipements`, seule route protégée.
3. **Équipements** : la liste, ses états de chargement, vide, erreur et
   données périmées relèvent de CAT-01 et RDY-02. La page protégée n'affiche
   qu'une information [P] à faire approuver.
