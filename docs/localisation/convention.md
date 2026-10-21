# Localisation Web et iOS — convention commune

Référence commune à Aegis Manager (Web) et Aegis Mobile (iOS). Les catalogues de
textes restent propres à chaque plateforme; ce document et le
[glossaire](glossaire.md) partagent les significations et les traductions
approuvées. Issue : #78.

## Langues

| Langue | Code | Formatage | Rôle |
|---|---|---|---|
| Français | `fr` | `fr-CA` | Langue de repli et de référence |
| Anglais | `en` | `en-CA` | Traduction complète des écrans livrés |

Une autre préférence (par exemple `es` ou `fr-FR`) ramène à la langue prise en
charge la plus proche : `fr*` donne le français, `en*` l'anglais, toute autre
langue le français. Une variante comme `fr-FR` reste formatée en `fr-CA`.

## Ce que la langue change, et ce qu'elle ne change pas

La langue change seulement la présentation : libellés, messages, formats et
textes d'accessibilité.

Elle ne change jamais :

- les règles métier, la readiness et les autorisations;
- les fuseaux horaires, quelle que soit la langue :
  - une heure métier (réservation, échéance, horaire) s'affiche dans le fuseau du
    casier fourni par l'API, jamais dans celui de l'appareil ou du navigateur;
  - un instant purement technique, comme l'heure renvoyée par la vérification de
    santé, s'affiche dans le fuseau de l'appareil;
  - en attendant que l'API expose le fuseau du casier, iOS n'affiche aucune heure
    métier, et le Web n'en affiche que dans l'exemple illustratif de l'accueil,
    avec le fuseau `America/Toronto` du laboratoire rendu explicite;
- les contrats : codes REST et MQTT, états techniques, identifiants (UUID,
  `assetCode`, `traceId`) et données saisies (noms, descriptions, numéros de
  série). On traduit la présentation d'un code, jamais le code.

Les noms de produits ne se traduisent pas : Aegis, Aegis Manager, Aegis Mobile,
Aegis Control.

## Choix de la langue

**Web.** Dans l'ordre :

1. le choix explicite de l'utilisateur, mémorisé dans le navigateur;
2. sinon, la première langue préférée du navigateur parmi `fr` et `en`;
3. sinon, le français.

Un sélecteur « Français / English » est accessible avant la connexion, sans
drapeau; chaque option est écrite dans sa propre langue et porte son attribut
`lang`. L'attribut `lang` du document et le titre de la page suivent la langue.
Aucune préférence n'est envoyée au serveur.

**iOS.** Localisation native, avec un String Catalog (`.xcstrings`) dans
`apps/ios` : langue de développement `fr` (la `developmentRegion` du projet),
localisations `fr` et `en`. Le choix de langue propre à l'application apparaît
dans Réglages dès que deux localisations existent. Si ni le français ni
l'anglais ne figure parmi les langues préférées, iOS revient à la langue de
développement, le français. Aucune préférence serveur ni nouvelle route.

**En-tête `Accept-Language`.** iOS l'envoie automatiquement à partir des langues
préférées. L'API ne change ni son comportement, ni ses codes, ni sa validation
selon cet en-tête; les clients n'affichent jamais le `detail` du serveur. Ce point
est vérifié dans le code de l'API et sera fixé par un test (#80).

## Formats

Toujours produits par les API de la plateforme (`Intl` sur le Web, `Formatter`
et `FormatStyle` sur iOS), jamais assemblés à la main.

- **Web :** formats `fr-CA` ou `en-CA` selon la langue choisie, y compris pour une
  préférence `fr-FR` ou `en-US`.
- **iOS :** formats de `Locale.current`, qui combine la langue de l'application,
  la région du système et le choix 12 h / 24 h de l'utilisateur. Un appareil en
  anglais avec la région France donne `en_FR`, pas `en-CA`. Avec les iPhone de
  démonstration réglés sur la région Canada, on obtient les formats du tableau.
  Imposer `fr-CA` et `en-CA` sur iOS, au détriment des réglages de l'utilisateur,
  est une **décision ouverte** pour Philippe.

| Élément | `fr-CA` | `en-CA` |
|---|---|---|
| Date longue | 21 octobre 2026 | October 21, 2026 |
| Heure | 15 h 20 | 3:20 p.m. |
| Heure avec fuseau | 15 h 20 HAE | 3:20 p.m. EDT |
| Nombre | 1 234,5 | 1,234.5 |
| Durée | 55 secondes | 55 seconds |

Exemples calculés avec `Intl` (Node 24) pour le 21 octobre 2026 à 19 h 20 UTC,
fuseau `America/Toronto`.

## Pluriels

Utiliser les catégories CLDR de la plateforme (`Intl.PluralRules`, variantes de
pluriel du String Catalog), jamais « (s) » ni un test `n > 1` écrit à la main.
Elles diffèrent : en français, 0 et 1 sont au singulier (« 0 seconde »,
« 1 seconde »); en anglais, seul 1 l'est (« 0 seconds », « 1 second »).

## Phrases et variables

- Une phrase complète par message, avec des variables nommées; jamais de phrase
  assemblée par concaténation, car l'ordre des mots change d'une langue à
  l'autre.
- Les valeurs insérées (date, durée, nombre) sont formatées avant d'être
  insérées, dans la langue du message.

## Erreurs

- Le message affiché vient du code d'erreur (doc 09 §7 et §21) et, pour un
  champ, du code de violation; il est rédigé dans les deux langues.
- Le texte `detail` ou `message` renvoyé par le serveur n'est jamais affiché tel
  quel.
- Le `traceId` s'affiche tel quel, sans traduction, introduit par un libellé ou
  une phrase traduits. Le Web utilise aujourd'hui la phrase « transmettez ce code
  au support : » / « give this code to support: »; un libellé visible commun
  (« Identifiant de suivi » / « Trace ID ») reste une **décision ouverte**.
- Après `429 RATE_LIMITED`, le délai s'affiche une seule fois et seulement à partir
  d'une valeur `Retry-After` valide : un entier de secondes. Le serveur envoie
  une valeur de 1 à 60; iOS refuse toute valeur hors de 1 à 3600. Sans valeur
  valide, le message dit seulement qu'il y a eu trop de tentatives. La
  documentation au doc 09 §10.2 est suivie dans #80.
- Un code inconnu affiche un message générique contrôlé et le `traceId`.

## Accessibilité

Les libellés d'accessibilité, les textes d'aide, les infobulles et les annonces
des zones dynamiques sont traduits comme le texte visible. Un écran n'est
déclaré bilingue que si ses erreurs et ses libellés d'accessibilité existent
dans les deux langues.

## Catalogues et processus

- Web : catalogues TypeScript `fr` et `en` dans `apps/admin-web`; iOS : String
  Catalog dans `apps/ios`. Aucune plateforme ne dépend des fichiers de l'autre.
- Tout nouveau texte arrive dans les deux langues dans le même changement.
- Un nouveau terme métier passe d'abord par le glossaire.
- Les traductions marquées « proposé » restent à valider par Philippe.

## Propriété

- Glossaire et présente convention : session API/Web, pour Philippe. La session
  iOS propose ses ajouts ou ses corrections par message ou dans l'issue
  concernée.
- Catalogues : chaque plateforme possède les siens (`apps/admin-web/**` pour le
  Web, `apps/ios/**` pour iOS).
