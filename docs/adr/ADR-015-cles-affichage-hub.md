# ADR-015 — Chiffrement des instructions d’affichage du hub par des clés hors PostgreSQL

**Statut :** ACCEPTED — Philippe, 11 novembre 2026 (mandat Backend sur #67); consigné par la PR de #43/#46

**Date de la décision :** 11 novembre 2026

**Liens :** ADR-009; document 08, §9.2 (`hub_display_outbox`); document 10, §27; issues #43 et #46

## Contexte

Le document 08 impose de chiffrer dans l’application les payloads de `hub_display_outbox`, avec un chiffrement authentifié, une clé externe à PostgreSQL et les identifiants de la ligne liés comme données authentifiées. Il ne fixe ni l’algorithme, ni le format de l’enveloppe, ni la provenance des clés, ni leur rotation. Le jeton du défi (§27.1) ne doit exister en clair que dans cette instruction : ni dans une réponse REST, ni dans un journal, ni dans l’audit.

## Décision

1. **Algorithme.** AES-256-GCM, nonce aléatoire de 96 bits par message, tag de 128 bits. `encrypted_payload` contient `nonce (12 octets) || ciphertext || tag (16 octets)`. Le message MQTT complet du §27.1 ou du §27.3 est chiffré : le dispatcher publie exactement les octets ouverts, sans rien reconstruire.
2. **Données authentifiées.** Le texte UTF-8 `aegis-display-aad/v1\n<id>\n<locker_id>\n<operation_id>\n<display_revision>` de la ligne. Un ciphertext déplacé vers une autre ligne, un autre casier, une autre opération ou une autre révision ne s’ouvre pas.
3. **Provenance des clés.** Variables d’environnement de l’API, jamais PostgreSQL ni Git :
   - `AEGIS_DISPLAY_KEYS` : liste `keyId:base64`, séparée par des virgules; chaque clé fait exactement 32 octets une fois décodée; `keyId` est court, sans `:` ni `,`, et unique;
   - `AEGIS_DISPLAY_ACTIVE_KEY_ID` : identifiant de la clé qui scelle les nouvelles instructions; il doit figurer dans la liste.
   `encryption_key_id` mémorise la clé de chaque ligne.
4. **Fermeture par défaut.** `AEGIS_DISPLAY_ENABLED=false` par défaut : aucune préparation n’est alors acceptée (`503 LOCKER_OFFLINE`) et aucune ligne dépendante d’une clé n’est créée. Avec `true`, une liste absente, mal formée, une clé de longueur incorrecte ou une clé active absente arrête l’API au démarrage. Des clés fournies alors que le flux est désactivé sont validées aussi. Le dispatcher (`AEGIS_DISPLAY_DISPATCHER_ENABLED=true`) exige MQTT et le flux activé.
5. **Échec d’ouverture.** Une ligne dont la clé n’est pas configurée ou dont l’authentification échoue n’est jamais publiée : elle passe à `CANCELLED`, son ciphertext est purgé, et `last_error` vaut `DISPLAY_PAYLOAD_KEY_NOT_CONFIGURED` ou `DISPLAY_PAYLOAD_AUTHENTICATION_FAILED`. Le défi n’est alors jamais affiché et expire. Les journaux ne contiennent que la raison, le `messageId` et le `keyId`.
6. **Rotation.** Ajouter la nouvelle clé à `AEGIS_DISPLAY_KEYS`, la rendre active et redémarrer; l’ancienne reste dans la liste. Une clé ne peut être retirée que lorsqu’aucune ligne non purgée n’en dépend :

   ```sql
   SELECT encryption_key_id, count(*)
   FROM aegis.hub_display_outbox
   WHERE encrypted_payload IS NOT NULL
   GROUP BY encryption_key_id;
   ```

   Au démarrage, l’API signale (niveau WARN, sans matériel de clé) chaque clé référencée par une ligne non purgée mais absente de la configuration. Les fenêtres d’affichage étant de 60 s au plus pour un défi et de 30 s pour un statut, et la purge s’exécutant toutes les 5 s, une clé n’a normalement plus de dépendance quelques minutes après sa désactivation.
7. **Purge.** Le ciphertext d’un défi est purgé à sa consommation, à son expiration, à son invalidation et au rejet de son instruction par le hub. Celui d’un statut est purgé à son échéance d’affichage. Seules les métadonnées restent.

## Alternatives écartées

- **pgcrypto ou chiffrement côté PostgreSQL :** la clé transiterait dans les requêtes SQL et serait à la portée du compte de base de données, ce que le document 08 exclut.
- **Gestionnaire de secrets externe (KMS, Vault) :** dépendance d’infrastructure non démontrée pour le P0; les variables d’environnement de la plateforme suffisent et restent compatibles avec un tel service plus tard.
- **AES-CBC avec HMAC, ou ChaCha20-Poly1305 :** équivalents en sécurité, mais AES-GCM est fourni par le JDK sans dépendance ni composition manuelle.
- **Chiffrer le seul jeton :** le reste du message porte la cible et la révision; chiffrer le message entier évite une reconstruction et laisse la base sans aucune donnée d’affichage en clair.

## Conséquences

- L’activation du flux en environnement partagé exige de fournir les deux variables dans le gestionnaire de secrets de la plateforme, avant d’activer `AEGIS_DISPLAY_ENABLED` puis `AEGIS_DISPLAY_DISPATCHER_ENABLED`. Aucune valeur réelle n’apparaît dans Git, les journaux, les réponses ou les captures.
- Une perte de toutes les clés rend les instructions en attente illisibles : elles sont annulées et leurs défis expirent; aucune donnée métier n’est perdue.
- Un nonce aléatoire de 96 bits impose de rester loin de 2³² messages par clé; le volume du P0 en est très éloigné, et la rotation remet le compteur à zéro.
- Le schéma (`encrypted_payload`, `encryption_key_id`) et les contrats REST et MQTT restent inchangés.

## Vérification

- `DisplayKeyRingTests` : formats refusés, clé active absente, ouverture avec une autre AAD, ciphertext modifié.
- `DisplayDispatcherTests` (PostgreSQL réel) : publication du message scellé, ciphertext ou AAD modifiés jamais publiés, ancienne clé conservée après rotation, clé retirée encore référencée, échéance passée.
- `check-hub-challenge.sh` (Mosquitto, ACL et simulateur réels) : démarrage refusé sans clé, rotation de `k1` vers `k2`, secret absent des journaux, du trafic lisible par le compte backend et d’un export de la base, précondition de retrait de `k1`.
