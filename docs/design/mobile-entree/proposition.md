# Aegis Mobile — connexion native, direction « Lumière du hub » v3

Mode : Prototype. Mise à jour du 21 octobre 2026. Issues : #35 (DES-01),
préalable à #36 (IOS-01); localisation coordonnée avec #78.

**Statut.** Philippe a sélectionné la direction « Lumière du hub », révision
v3 sans illustration (brief du 21 octobre 2026; référence
`aegis-lumiere-du-hub-v3.html`). Cette page présente son **adaptation native**
et les **nouveaux textes**. Elle doit être validée avant l'intégration dans
#36. La version précédente (« Verre lumineux », 23 septembre) est remplacée;
ses captures ont été retirées.

Les captures viennent d'un prototype SwiftUI statique, compilé avec le SDK iOS
dans une copie temporaire de `apps/ios`. Le code de l'application n'est pas
modifié.

## Adaptation native de la v3

| Zone | Référence v3 | Adaptation iOS |
|---|---|---|
| En-tête | Marque, puis signature sur trois lignes, halo bleu localisé | Identique. **Compacté** (marque seule) dès qu'un champ a le focus ou en taille de texte d'accessibilité |
| Marque | « A » abstrait avec noyau, `aegis`, filet, `CORE` | Monogramme en asset vectoriel `AegisMark` (clair et sombre); `aegis` et `CORE` en texte SwiftUI. VoiceOver lit « Aegis », en en-tête |
| Panneau | Coins supérieurs de 27 pt, filet supérieur | Identique; le fond continue jusqu'en bas de l'écran |
| Titre | Surtitre, « Connexion », sous-titre | Styles Dynamic Type (`caption2`, `title`, `subheadline`) |
| Champs | Groupe à fond distinct, libellés persistants | `TextField` (`.username`, clavier courriel) et `SecureField` (`.password`, action Aller); bouton œil de 44 × 44 pt. Aucun placeholder pour le mot de passe : le libellé suffit |
| Bouton | Plein, coins de 14 pt, flèche à droite, 54 pt de haut | Bouton natif avec style personnalisé. Pendant l'envoi : indicateur et « Connexion… », appuis ignorés, VoiceOver lit « Connexion en cours » |
| Erreur | Bandeau teinté, une phrase | Une phrase courte, avec symbole; le délai `Retry-After` n'apparaît qu'ici |
| Apparence | Sombre profond, Clair minéral | Apparence système; aucun sélecteur ajouté |

Aucune illustration, aucun casier ni indicateur « connecté » ou « sécurisé »
avant l'authentification.

## Textes (FR de référence, EN proposé)

Tous les textes nouveaux ou raccourcis sont **à valider**.

| Clé | Français | English | Statut |
|---|---|---|---|
| Signature | Prêt. Autorisé. Prouvé. | Ready. Authorized. Proven. | à valider (brief) |
| Surtitre | Espace technicien | Technician access | proposé (v3 / EN) |
| Titre | Connexion | Sign in | approuvé (FR) |
| Sous-titre | Vos équipements. Votre activité. | Your equipment. Your activity. | proposé (v3 / EN) |
| Exemple de courriel | nom@entreprise.ca | name@company.ca | proposé |
| Action | Se connecter | Sign in | approuvé (FR) |
| Envoi | Connexion… (lu : « Connexion en cours ») | Signing in… (« Signing in ») | proposé |
| Mention | Compte fourni par votre administrateur. | Account provided by your administrator. | approuvé (FR) |
| Courriel invalide | Saisissez une adresse courriel valide. | Enter a valid email address. | proposé, raccourci |
| Mot de passe vide | Saisissez votre mot de passe. | Enter your password. | proposé |
| 401 identifiants | Adresse courriel ou mot de passe incorrect. | Incorrect email address or password. | approuvé (FR); corps supprimé |
| 429 avec délai valide | Trop de tentatives. Réessayez dans 55 secondes. | Too many attempts. Try again in 55 seconds. | proposé (T1) |
| 429 sans délai valide | Trop de tentatives. Réessayez plus tard. | Too many attempts. Try again later. | proposé |
| Réseau | Connexion au service impossible. Vérifiez le réseau. | Can't reach the service. Check your network. | approuvé (FR) |
| Session expirée | Votre session a expiré. Vos réservations et prêts sont conservés. | Your session has expired. Your reservations and loans are kept. | approuvé, raccourci (« Reconnectez-vous. » retiré : le formulaire le dit) |
| Reprise hors ligne, titre | Connexion au service impossible | Can't reach the service | proposé |
| Reprise hors ligne, corps | Votre session est conservée, mais elle n'a pas pu être vérifiée. Aucune action n'est possible hors ligne. | Your session is kept but couldn't be verified. No action is available offline. | proposé |
| Reprise hors ligne, actions | Réessayer · Se déconnecter | Try again · Sign out | proposé |
| Libellé du `traceId` | Identifiant de suivi | Trace ID | glossaire #78 |

Les autres états de la matrice précédente (erreur du service avec
`traceId`, session invalide, déconnecté, mauvais rôle) gardent leur logique,
avec des textes d'une phrase au même format.

Le délai est formaté nativement (`Duration`, unités longues) et accordé selon
le pluriel CLDR. Il n'est affiché que pour un `Retry-After` en secondes
entières, de 1 à 3600. Côté serveur, la valeur va de 1 à 60; sa documentation
dans `09` §10.2 est suivie par la session API dans #80.

## Session et reprise

- Contrat inchangé : jeton au Keychain, 60 min sans refresh token; un 401 ou
  l'expiration invalide la session.
- **Reprise hors ligne** (décision de Philippe) : si `GET /auth/me` est
  injoignable au lancement alors que le jeton n'est pas expiré, le jeton est
  conservé et l'écran propose Réessayer et Se déconnecter. La session n'est
  pas présentée comme vérifiée et aucune action métier n'est offerte.

## Marque et conversion des assets

- `marque/` ne contient que ce que l'écran utilise : le monogramme fourni,
  copié tel quel, et `aegis-core-mark-dark.svg`. Cette variante sombre est
  **dérivée** du groupe de `aegis-core-logo-dark.svg` (couleurs `#8CAEFF` et
  `#64D8EB`), sans autre changement. Les logos complets et la référence
  partagée sont tenus par la session API/Web dans `docs/design/identite/`
  (#79).
- Dans Xcode, le monogramme est un ensemble d'images SVG à variante sombre,
  vecteur conservé. Il est rendu correctement à 34 pt dans les deux
  apparences (captures).
- Les logos complets portent `aegis` et `CORE` en `<text>` avec la police
  Inter, ni embarquée ni vectorisée. Xcode ne garantit pas le rendu de ce
  texte. **Conversion retenue :** monogramme en asset, mots en texte SwiftUI
  (police système). Une version vectorisée du logotype par le designer
  rendrait cette substitution inutile.
- Remplacement : changer les deux fichiers de `AegisMark.imageset` suffit; le
  nom du projet, du bundle et des modules reste « Aegis Mobile ».
- Nommage : d'accord avec l'option A de #79 (marque commune « Aegis » portée
  par le monogramme, noms d'applications inchangés).

## Contrastes mesurés (WCAG, valeurs des jetons v3)

| Paire | Sombre | Clair |
|---|---|---|
| Texte / panneau | 16,8 | 15,9 |
| Texte secondaire / panneau | 9,2 | 6,0 |
| Texte secondaire / champ (placeholder, bouton désactivé) | 8,4 | 5,5 |
| « Prouvé. » (accent) / en-tête | 8,9 | 6,3 |
| Blanc / bouton | 5,4 | 7,1 |
| Erreur / fond d'erreur | 10,2 | 6,8 |
| Monogramme « A » / en-tête | 8,9 | 6,3 |
| Noyau du monogramme / en-tête | 11,6 | 4,4 |
| **Bordure des champs / panneau** | **1,6** | **1,3** |

Tout le texte dépasse 4,5:1. La bordure des champs n'atteint pas 3:1 :
le libellé persistant identifie chaque champ. Avec « Augmenter le
contraste », la bordure prend la couleur du texte secondaire (≥ 5,5:1), comme
le montre `fr-inactif-light-contrast.png`.

Taille minimale du monogramme : **24 pt recommandés** (taille du petit
spécimen v3, noyau de 6 pt). Seul le rendu à 34 pt a été vérifié.

## Captures

`captures/`, iPhone 17, simulateur iOS 26.3.1, 21 octobre 2026 :

| Demande du brief | Fichier |
|---|---|
| Nominal sombre, français | `fr-inactif-dark.png` |
| Nominal clair, français | `fr-inactif-light.png` |
| Nominal anglais | `en-inactif-dark.png`, `en-inactif-light.png` |
| Erreur | `fr-identifiants-refuses-dark.png`, `en-identifiants-refuses-light.png` |
| Clavier ouvert | `fr-clavier-dark.png` |
| Très grand texte | `fr-inactif-light-ax.png` |
| Autres | `fr-trop-de-tentatives-light`, `fr-envoi-dark`, `fr-reprise-hors-ligne-dark`, `en-reprise-hors-ligne-light`, `fr-validation-light`, `fr-service-injoignable-dark`, `fr-session-expiree-light`, `fr-inactif-light-contrast` |

Reproduire (tant que #16 n'est pas fusionné, `IOS_APP_DIR` désigne
`apps/ios` de la branche `16-feat-ios-skeleton`) :

```bash
IOS_APP_DIR=<chemin vers apps/ios> docs/design/mobile-entree/prototype/render.sh
```

## Contrôles exécutés et limites

| Contrôle | Statut |
|---|---|
| Rendu natif clair, sombre, FR, EN, clavier, très grand texte, Augmenter le contraste | exécuté (captures) |
| Contrastes des jetons | calculés (tableau) |
| Cible de 44 pt pour l'œil, bouton de 54 pt | dans le code du prototype |
| VoiceOver (ordre, libellés, annonce d'envoi) | **non exécuté**; libellés présents dans le code |
| Réduire les animations | **non vérifié en rendu**; l'animation de compactage est supprimée dans le code |
| Clavier français | le simulateur affiche son clavier système anglais |
| iPhone 11 et iPhone 15 Plus | **non testés**; versions iOS à relever |

## Décisions à valider

1. L'adaptation native ci-dessus et les textes marqués « proposé » ou
   « raccourci ».
2. La signature FR/EN, que le brief garde à valider.
3. Le renforcement de la bordure des champs limité au mode « Augmenter le
   contraste », plutôt qu'une bordure plus foncée par défaut.
