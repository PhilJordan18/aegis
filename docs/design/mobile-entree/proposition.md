# Aegis Mobile — proposition : écran natif de connexion et ses états

Mode : Prototype. Date : 21 octobre 2026. Issues : #35 (DES-01), préalable à
#36 (IOS-01).

**Statut : proposition non approuvée.** La direction A « Verre lumineux » et
la structure de `../asset-lifecycle/sections.md` §3 sont approuvées; les
détails ci-dessous (composition, textes marqués [P], couleurs) ne le sont
pas. Aucun code de l'application n'a été modifié : les captures viennent d'un
prototype SwiftUI compilé dans une copie temporaire du projet.

## Sources

- `sections.md` §3 (connexion, approuvée) et U6 (mauvais rôle);
- `../manager-entree/states.md` : matrice Web des mêmes états, reprise pour la
  cohérence entre plateformes;
- `09` §4 (JWT de 60 min, aucun refresh token, Keychain, déconnexion locale),
  §10.2–10.3 et §21 (codes d'erreur).

Légende des textes : [A] approuvé dans `sections.md`; [P] proposé (repris du
handoff Web quand il existe).

## Composition native

| Élément | Choix iOS | Raison |
|---|---|---|
| Marque | Mot « Aegis » en titre 3 gras, couleur `accent-text` | Pas de logo approuvé; le monogramme Web reste provisoire (Q6 Web) |
| Titre | « Connexion » [A], `largeTitle` gras | Hiérarchie de `sections.md` §3 |
| Alerte | Bandeau unique entre le titre et les champs, sur fond opaque teinté (erreur, avertissement, information), symbole SF + titre + corps | Même zone que le Web; jamais une alerte système modale |
| Champs | Groupe opaque de deux rangées avec libellé visible : « Adresse courriel » (`.username`, clavier courriel, sans majuscule ni correction) et « Mot de passe » (`.password`, bouton œil de 44 pt « Afficher le mot de passe ») | Remplissage automatique des mots de passe; libellés persistants pour VoiceOver et le grand texte |
| Action | « Se connecter » [A], bouton proéminent pleine largeur; la touche Retour du mot de passe envoie | Un seul bouton principal |
| Mention | « Compte fourni par votre administrateur. » [A], toujours sous le bouton | Ni création de compte, ni mot de passe oublié, ni institution |
| Fond | Canevas et lueur bleu–indigo du traitement A, supprimée en transparence réduite; aucun verre derrière les champs | Formulaires et erreurs sur fond stable (`direction-validee.md`) |

## États

| État | Déclencheur | Traitement et textes | Focus / VoiceOver | Valeurs |
|---|---|---|---|---|
| `reprise` | Lancement avec un jeton au Keychain dont `expiresAt` est futur; `GET /auth/me` en cours | Marque, indicateur, « Reprise de la session… » [P] | Annonce du texte | — |
| `inactif` | Aucun jeton, ou jeton expiré localement (effacé sans appel) | Formulaire vide | Courriel | — |
| `validation` | Champ vide ou courriel mal formé, sans requête; 400 `VALIDATION_ERROR` | Message sous le champ avec symbole : « Saisissez votre adresse courriel. », « Saisissez une adresse courriel valide, par exemple nom@example.com. », « Saisissez votre mot de passe. » [P] | Premier champ invalide | Conservées |
| `envoi` | Requête en cours (15 s au plus) | « Connexion… » [P] avec indicateur; le bouton garde son aspect mais ignore les appuis; champs en lecture seule | Annonce « Connexion en cours. » [P] | Conservées |
| `identifiants-refuses` | 401 `AUTH_INVALID_CREDENTIALS` | Erreur : « Adresse courriel ou mot de passe incorrect. » [A] · « Vérifiez les deux champs, puis réessayez. » [P] | Mot de passe | Courriel gardé, mot de passe vidé |
| `trop-de-tentatives` | 429 `RATE_LIMITED` | Avertissement : « Trop de tentatives. » + « Réessayez dans 55 secondes. » si `Retry-After` est reçu [P, T1 Web], sinon « Réessayez dans une minute. » [A]. Bouton désactivé et « Disponible dans 0:55 » jusqu'à l'échéance | Annonce unique; « Vous pouvez réessayer. » [P] à l'échéance | Conservées |
| `service-injoignable` | Erreur réseau, délai dépassé, 5xx sans `problem+json` | Avertissement : « Connexion au service impossible. » + « Vérifiez le réseau, puis réessayez. » [A découpé, T3 Web] | Annonce | Conservées |
| `erreur-service` | 5xx avec `problem+json`, ou statut inattendu | Erreur : « Le service n'a pas pu traiter la connexion. » + « Réessayez dans un instant. Si le problème persiste, transmettez ce code au support : » + `traceId` sélectionnable [P] | Annonce | Conservées |
| `session-expiree` | `expiresAt` dépassé (au retour au premier plan ou en cours d'usage), ou 401 `AUTH_TOKEN_EXPIRED` | Information : « Votre session a expiré. Reconnectez-vous. » + « Vos réservations et prêts sont conservés. » [A, découpé en titre et corps] | Mot de passe | Courriel prérempli |
| `session-invalide` | 401 `AUTH_TOKEN_INVALID` | Information : « Votre session n'est plus valide. Reconnectez-vous. » + « Aucune réservation, aucun prêt ni aucune opération n'a été modifié. » [P] | Mot de passe | Courriel prérempli |
| `deconnecte` | Après « Se déconnecter » confirmé dans Compte (« Vous déconnecter ? Votre réservation et votre prêt restent actifs. » [A]) | Information : « Vous êtes déconnecté. » [P] | Courriel | Vides |
| `role-non-autorise` | 200 avec `user.role = ADMIN` (U6); jeton effacé, aucune donnée chargée | Titre « Accès réservé aux techniciens » [P]; avertissement « Ce compte administrateur s'utilise dans Aegis Manager sur le Web. » [A, U6] + corps [P]; « Compte utilisé » [P]; bouton « Se connecter avec un autre compte » [P] | Titre | Formulaire vide au retour |

Dans tous les états, aucun `detail` ni `title` du serveur n'est affiché : seuls
le `code` et le `traceId` sont exploités. Le jeton n'est jamais journalisé.

## Comportement de session (pour #36)

- Jeton et `expiresAt` dans le Keychain, accessibles seulement quand
  l'appareil est déverrouillé et sur cet appareil; jamais dans `UserDefaults`.
- Pas de refresh token : à `expiresAt`, ou sur tout 401 d'une route protégée,
  le jeton est effacé et l'écran revient à la connexion.
- Après reconnexion, retour à Mon activité si une réservation ou un prêt
  existe (`sections.md` §3); l'expiration ne suspend aucune opération
  physique déjà autorisée (`09` §4.2).
- Déconnexion : suppression locale seulement (aucune route serveur, `09`
  §4.2).
- Pas de Face ID ni d'inscription : absents du contrat et du P0.

## Décisions à valider

1. **Composition** de l'écran (captures ci-dessous) : marque textuelle,
   bandeau unique, libellés visibles, mention sous le bouton.
2. **Textes [P]**, en particulier T1 (délai réel de `Retry-After`). Comme sur
   le Web, l'en-tête est envoyé par l'API mais n'est pas documenté dans `09`
   §10.2 (défaut déjà signalé, Q1 du handoff Web).
3. **Reprise hors ligne** : au lancement, si `GET /auth/me` est injoignable
   alors que le jeton est encore valide, proposition : garder le jeton et
   afficher « Connexion au service impossible. » avec « Réessayer » et
   « Se déconnecter », plutôt que d'effacer la session.
4. **Couleurs des bandeaux** reprises des jetons Web (`blocked`, `unknown`,
   `info`) : valeurs de prototype, non approuvées pour iOS.

## Captures

Dans `captures/`, iPhone 17 (simulateur iOS 26.3.1), rendu le 21 octobre
2026 :

- les 12 états, en thème clair : `<état>-light.png`;
- en thème sombre : `inactif`, `trop-de-tentatives`, `session-expiree`,
  `role-non-autorise`;
- en très grand texte : `identifiants-refuses-light-ax.png`.

Reproduire, tant que #16 n'est pas fusionné (sinon `IOS_APP_DIR` est
facultatif) :

```bash
IOS_APP_DIR=<chemin vers apps/ios de la branche 16-feat-ios-skeleton> docs/design/mobile-entree/prototype/render.sh
```

## Limites des preuves

- Simulateur seulement : aucun iPhone physique disponible. Clavier,
  remplissage automatique et caméra ne sont pas montrés ni vérifiés.
- Contrastes jugés à l'œil sur les rendus, non mesurés; VoiceOver,
  Augmenter le contraste et Réduire les animations non vérifiés.
- Le prototype affiche des valeurs fixes; il ne valide ni le contrat ni la
  session.
