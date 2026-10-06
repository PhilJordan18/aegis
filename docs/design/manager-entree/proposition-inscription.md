# Proposition : parcours d'inscription (décision en attente, à ne pas implémenter)

Date : 30 septembre 2026. Mode : Discovery. Auteur : ui-ux-designer.
Destinataire : Philippe.

**Cadre.** Le P0 exclut l'inscription publique, l'authentification sociale
et la récupération autonome du mot de passe (`02-scope.md` §11.1). Les
comptes sont préparés, et les invitations de membres sont une évolution
future. Retenir l'une des options ci-dessous exigerait trois choses :

1. une décision humaine;
2. un **nouvel ADR** qui référence ADR-007 (ADR-007, accepté, n'est pas
   modifié);
3. une mise à jour de `02` et `09`.

**Aucune entrée « Créer un compte » n'apparaît dans cette tranche** : ni sur
l'accueil, ni sur la connexion, ni dans le shell.

## Hypothèses communes aux deux options

- **Institution :** implicite. Un déploiement sert une institution en P0; le
  multi-institution est reporté. Aucun choix, aucun champ.
- **Rôle et niveau d'accès :** toujours attribués par un administrateur,
  jamais auto-attribués. Défaut au moindre privilège : `TECHNICIAN` et
  `STANDARD`. Promouvoir un compte `ADMIN` ou `RESTRICTED` est une action
  distincte, confirmée et auditée.
- **Place dans le Manager :** aucune des six sections approuvées n'est
  « Comptes » ou « Utilisateurs ». Il faudrait une **septième section** ou
  une page d'administration du compte. C'est un changement de la structure
  approuvée (`sections.md`), à trancher.
- **Contrat :** de nouvelles routes seraient à spécifier dans `09`. Leurs
  formes ne sont **pas** inventées ici.
- **Audit :** chaque transition (création, envoi, acceptation, expiration,
  révocation, approbation, refus, attribution de rôle) produit un événement
  d'audit non destructif.

## Option A — invitation par un administrateur

**Parcours :**

1. L'administrateur saisit le courriel, le nom affiché, le rôle et le niveau
   d'accès, puis crée l'invitation.
2. Le système envoie un lien **à usage unique** qui expire (durée à fixer,
   par exemple 72 h).
3. La personne ouvre le lien, choisit son mot de passe (règles
   à définir : `02` n'en fixe aucune), et le compte est activé.
4. Connexion normale.

**États :** invitation `PENDING → ACCEPTED | EXPIRED | REVOKED`; compte
`ACTIVE` à l'acceptation. Un renvoi invalide le lien précédent.

**Risques et mesures :**

- **Vol ou transfert du lien.** Mesures : jeton aléatoire long, stocké
  haché, usage unique, expiration, lien lié au courriel invité, aucune
  divulgation de l'existence d'un compte.
- **Abus par un administrateur compromis.** Mesures : audit et limite de
  débit sur la création.

**Infrastructure :**

- envoi de courriels : fournisseur SMTP ou API, domaine et SPF/DKIM;
- page publique d'acceptation;
- tâche d'expiration.

## Option B — inscription ouverte avec approbation par un administrateur

**Parcours :**

1. Page publique « Demander un accès » : courriel, nom et motif.
2. Vérification du courriel (lien à usage unique).
3. La demande entre en file (`PENDING_APPROVAL`).
4. L'administrateur approuve, en attribuant le rôle et le niveau d'accès, ou
   refuse.
5. La personne reçoit un lien pour définir son mot de passe.

**États :** demande
`SUBMITTED → EMAIL_VERIFIED → APPROVED | REJECTED | EXPIRED`; compte actif
seulement après approbation et définition du mot de passe.

**Risques et mesures :**

- **Énumération de comptes.** Mesure : réponse identique pour un courriel
  connu ou inconnu.
- **Pollution de la file et spam.** Mesures : limites de débit par IP et par
  courriel, défi anti-robot éventuel, purge des demandes non vérifiées.
- **Hameçonnage** par imitation de la page publique.
- **Surface publique supplémentaire à protéger.**

**Infrastructure :** celle de l'option A, plus une file de modération, des
notifications à l'administrateur et une politique de rétention des demandes
refusées.

## Comparaison

| Critère | A — Invitation | B — Demande et approbation |
|---|---|---|
| Surface publique | Page d'acceptation seulement | Formulaire public, vérification, acceptation |
| Qui initie | Administrateur | Utilisateur |
| Moindre privilège | Natif | Natif (approbation obligatoire) |
| Risque d'énumération ou de spam | Faible | Moyen à élevé |
| Charge d'infrastructure | Courriel et expiration | Courriel, file, notifications, anti-abus |
| Adéquation au marché (équipes de 20 à 200 actifs) | Forte : l'effectif est connu | Faible : peu de demandes spontanées |
| Effort estimé | Moyen | Élevé |
| Jalon | P1 au plus tôt, après un P0 stable | P2 |

## Recommandation

**Option A (invitation), en P1 au plus tôt**, par un nouvel ADR.

Compromis : l'administrateur porte toute la charge de création. C'est
acceptable pour des équipes de taille connue, et cela évite une surface
publique et une file de modération. D'ici là, les comptes restent préparés
(démonstration : `AEGIS_DEMO_ACCOUNTS_ENABLED`, `services/api/README.md`).

La récupération du mot de passe réutiliserait le même mécanisme de lien à
usage unique. Elle mérite une décision couplée, car elle est tout aussi
exclue du P0.
