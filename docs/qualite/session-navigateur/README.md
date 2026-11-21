# Sondes QA de la session navigateur révocable (#178)

Ces sondes vérifient en boîte noire l'ADR-016 (session navigateur révocable) et l'ADR-017 (révocation au changement de mot de passe, rétention bornée). Elles vérifient aussi le parcours Manager correspondant dans Chromium. Elles tournent sur une pile **jetable et isolée** : PostgreSQL, Mosquitto et l'API construite depuis le commit testé. Elles ne touchent ni le staging, ni Railway, ni le hub de Jimmy.

Elles ne remplacent ni les tests Maven et Vitest de la CI, ni la recette staging (Railway, Caddy, origine publique, Safari), qui reste à faire par un humain.

## Lancer

Depuis la racine d'un checkout **du commit à tester** (par exemple la tête de la PR #180) :

```bash
QA=/chemin/vers/docs/qualite/session-navigateur   # ce dossier, depuis n'importe quel checkout
bash "$QA/s-browser-session.sh"     # S1-S13, ADR-016          (~3 min)
bash "$QA/v-password-change.sh"     # V1-V9, ADR-017           (~8 min)
bash "$QA/r-password-rotation.sh"   # R0-R8, cookie contre JWT (~1 min)
bash "$QA/w-web-flows.sh"           # recette Web réelle + W1-W14 Chromium (~8 min)
```

Lancez les scripts **l'un après l'autre** : ils reconstruisent le même JAR dans le checkout.

Chaque script se termine avec un code de sortie égal au nombre d'échecs (`0` = tout PASS).

- Un code `1` avec `FAIL BLOCKED api` signifie que l'API n'a pas démarré.
- Un code `2` avec `FAIL BLOCKED environment` signifie que Docker n'était pas disponible.

Ces deux cas sont des **problèmes d'environnement**, pas des défauts du produit.

**Prérequis :**
- Docker avec Compose, Java 21, `python3`, `openssl`, `curl` ;
- pour `w-web-flows.sh` : `npm ci` déjà fait dans `apps/admin-web`, et Chromium de Playwright (`PLAYWRIGHT_BROWSERS_PATH` si les navigateurs sont installés ailleurs).

**Ports et projets Compose :** chaque script a les siens, distincts de `aegis-dev` et de `aegis-recette`.

| Script | Projet Compose | PostgreSQL | Mosquitto | API |
|---|---|---|---|---|
| `s-` et `r-` | `aegis-qa-session` | 58573 | 55024 | 19421 |
| `v-` | `aegis-qa-session2` | 58583 | 55034 | 19431 |
| `w-` | `aegis-qa-web` | 58593 | 55044 | 19441 |

`w-` utilise aussi les ports Web 5181 et 5182. Les volumes sont supprimés à la fin du run.

## Secrets et nettoyage

- Les mots de passe de démonstration sont tirés au hasard à chaque run (`openssl rand`). Ils vivent seulement dans des variables du shell et ne sont jamais affichés.
- Les captures de réponses contiennent des cookies et des jetons. `lib.sh` les **supprime à la sortie**. Seuls les journaux `*.log` de l'API restent dans le dossier temporaire affiché (`logs: …`).
- S13 et V8a vérifient justement que ces journaux ne contiennent aucune valeur de cookie, de jeton, de mot de passe ou d'empreinte.
- Ne publiez ni ces dossiers, ni une trace Playwright, ni un HAR.

## SQL de mise en place

Certains cas préparent leur état par SQL, **uniquement dans la base jetable** :
- désactiver un compte ou changer son rôle ;
- vieillir une ligne de session pour la purge ;
- tenter un `UPDATE` ou un `DELETE` interdit pour prouver un déclencheur.

Aucun cas ne touche à la garde (custody), aux réservations, aux prêts ni à `READY`.

## Ce que couvre chaque script

| Script | Cas | Nature |
|---|---|---|
| `s-browser-session.sh` | S1-S13 : Origin exacte (absente, étrangère, `/` final, `null`, majuscules, http), attributs du cookie, empreinte SHA-256 seulement, cookie refusé comme bearer, refresh sans rotation et concurrent, technicien 403, déconnexion, compte désactivé et changement de rôle, fin absolue, refus au démarrage (13 h, http hors localhost), CHECK 12 h, journaux propres | API réelle |
| `v-password-change.sh` | V1-V9 : jeton borné par la fin de session, 10 refresh concurrents, 15 courses révocation/refresh, ligne révoquée immuable, rotation réelle par le provisionneur (25 sessions, un seul audit, technicien intact, redémarrage sans changement), martelage de l'ancien mot de passe pendant la rotation, purge à 30 jours, suppression d'une session ouverte refusée, journaux `ca.aegis` à TRACE | API réelle |
| `r-password-rotation.sh` | R0-R8 : rotation réelle, **cookie contre JWT déjà émis** | API réelle |
| `w-web-flows.sh` | recette Web `playwright.api.config.ts`, puis W1-W14 dans Chromium (`qa-browser.mjs`) | API réelle, plus quatre cas **à panne injectée** (W6-W9) |

**Cas à panne injectée :** W6 coupure réseau, W7 503, W8 403 et W9 500 à la déconnexion. Ils interceptent **une seule route** dans le navigateur, le reste passe par l'API réelle. Ils sont rapportés séparément.

Les tests Playwright `playwright.session.config.ts` du Web **simulent toute l'API** : ils ne prouvent pas l'intégration.

## Rapport de livraison — tête combinée `1e464af` (PR #180)

**Commit testé :** `1e464affbfd5be90bc68c8675432bce8a51bca2e`. C'est Web `a33009e` plus une ligne de documentation (09 §10.6).

**Verdict publié :** [#178](https://github.com/PhilJordan18/aegis/issues/178#issuecomment-7062790555), **PASS sans constat bloquant**.

| Lot | Résultat |
|---|---|
| Web hors ligne : typecheck, lint, vitest, build, `playwright.session.config.ts` (API simulée) | rc=0 ; 32/32 |
| Recette Web contre l'API réelle (`playwright.api.config.ts`) | 17/17 |
| W1-W14 Chromium, API réelle | tous PASS |
| W6-W9, panne injectée | tous PASS |
| S1-S13 | tous PASS |
| V1-V9 | tous PASS ; observations V1b et V8b |
| R0-R8 | conforme : cookie révoqué `PASSWORD_CHANGED`, JWT déjà émis encore 200 |
| CI de la PR #180 à `1e464af` | les contrôles requis `CI result` et `Source branch` sont verts ; **la Quality Gate SonarCloud est rouge** (note de sécurité C sur le nouveau code) à cause de 2× `typescript:S2245` (`Math.random`) dans `sessionSync.ts:64` (nonce du repli localStorage) et `e2e/sessionFakes.ts:152` (faux de test). Ce n'est pas une faiblesse exploitable, mais c'est à corriger par Web (`crypto.randomUUID()`) ou à justifier dans Sonar avant le merge |

**Rotation du mot de passe**
- **Cookie :** la session navigateur est révoquée dans la transaction du changement. La restauration suivante répond 401 et le Manager revient à la connexion (R4, V5a, W4).
- **JWT déjà émis :** il reste valide jusqu'à son expiration, au plus 60 min (R3, V5d). C'est le contrat : 09 §10.6, ligne « Changement réel du mot de passe ». La révocation de ces jetons est l'ADR-018 A+B, acceptée pour **#179**.
- **Non bloquant pour #178.**

**Observations non bloquantes, déjà documentées par Backend**
- V1b : le jeton remis par la connexion elle-même n'est pas borné par la fin de session (09 §10.6).
- V8b : à TRACE **racine**, les journaux du framework (Tomcat, pgjdbc, Spring JDBC) exposent mot de passe, cookie, hash et empreinte. Ne jamais activer TRACE racine.
- Le provisionneur applique la rotation environ 300 ms après que Tomcat accepte des requêtes : ligne de runbook.

**Pas couvert :** Railway, Caddy et l'origine publique, Safari et WebKit, le repli BroadcastChannel sur un navigateur qui ne l'a pas, et la CI de la PR (lue sur la PR, voir #178).
