# ADR-014 — Recherche `q` comptée en graphèmes, commune à l’API, au Web et à iOS

**Statut :** PROPOSED — consigne la décision commune API, Web et iOS du 28 octobre 2026; la liste des espaces retirés et le corpus partagé sont à confirmer à la revue de #109

**Date de la décision :** 28 octobre 2026

**Date de consignation :** 28 octobre 2026

## Contexte

Le document 09 limitait `q` à « 1 à 100 caractères » et demandait de retirer les « espaces extérieurs », sans définir ni le caractère ni l’espace. Une revue indépendante du 28 octobre 2026 a montré que l’API comptait des unités UTF-16 (51 emoji refusés, 50 acceptés) et que `String.strip()` gardait U+00A0. Sur la branche `34-feat-ios-asset-catalog`, iOS compte aussi en UTF-16, retire `whitespacesAndNewlines` et tronque la saisie. Trois fonctions nommées « length » ou « count » n’appliquaient donc pas la même règle.

## Décision

1. La limite est de 100 caractères perçus par l’utilisateur : des grappes de graphèmes étendues selon Unicode UAX #29, comptées après nettoyage. Ni unités UTF-16, ni points de code.
2. Le nettoyage retire seulement, au début et à la fin, les espaces Unicode : les 19 points de code de catégorie générale `Z` énumérés au document 09, §22.3, dont U+0020, U+00A0 et U+202F. Les espaces intérieurs restent. Ce correctif n’ajoute aucun changement de casse, d’accent ni de normalisation Unicode.
3. De 1 à 100 graphèmes, la recherche est admissible. Un texte vide après nettoyage ou de plus de 100 graphèmes retourne `400 VALIDATION_ERROR` avec `SIZE`, sans troncature silencieuse.
4. Les caractères de contrôle restent refusés avec `INVALID_VALUE` (§23.2). N’étant pas des espaces, ils ne sont plus retirés en bordure. Les séquences des emojis composés (ZWJ, sélecteur de variante, modificateur de teinte) ne sont jamais retirées.
5. Une recherche vide dans une interface signifie « aucun filtre » : le client omet `q`. Un `q` vide envoyé explicitement reste refusé.
6. L’API reste l’autorité. Le Web et iOS anticipent la même validation, présentent leur message traduit et ne bloquent ni ne tronquent la composition au clavier.
7. Le corpus `docs/cahier-conception/09-corpus-recherche-q.json` est lu par les tests des trois composants. Chaque composant consigne son implémentation et sa version Unicode au §22.3 du document 09.

## Alternatives écartées

- **Unités UTF-16** (`String.length()` en Java, `length` en JavaScript, `utf16.count` en Swift, attribut HTML `maxlength`) : un emoji compte de 2 à plus de 10 unités.
- **Points de code** : `e` suivi d’un accent combinant compte 2, un drapeau 2, une séquence ZWJ 3 ou plus.
- **Fonctions de nettoyage des plateformes** : `strip()` en Java garde U+00A0, `trim()` en JavaScript retire U+FEFF, `whitespacesAndNewlines` en Swift retire U+0085. Une liste explicite évite ces écarts.

## Conséquences

- L’interprétation de `q` change dans le document 09 (§11.1, §22.3; `GET /admin/assets` reprend §11.1) sans champ ni code nouveau. Une recherche non ASCII admet désormais plus de points de code. Un `q` qui commence ou finit par une tabulation ou un saut de ligne n’est plus nettoyé en silence : il retourne `INVALID_VALUE`, comme §23.2 le prévoyait déjà.
- Le résultat dépend de la version Unicode de chaque bibliothèque. Unicode 15.1 a ajouté la règle GB9c : `क्षि` compte 2 graphèmes sous le JDK 21 de la CI (Unicode 15.0) et 1 sous le JDK 25 (Unicode 16.0). Près de la borne, un client et l’API peuvent diverger; l’API tranche. Le corpus se limite aux séquences stables depuis Unicode 11.
- La limite en graphèmes ne borne pas la taille technique : un graphème peut contenir de nombreux points de code. La limite de 8 Kio des en-têtes HTTP de Spring Boot reste la protection de taille; aucune seconde limite utilisateur n’est créée.
- Livraison par des PR coordonnées sous #109 : contrat et API d’abord, puis Web et iOS, avec une vérification de compatibilité sur le corpus avant intégration. Ce correctif passe après la consolidation et la recette en cours.

## Vérification

- API : `SearchTextTests` lit les 44 cas du corpus et vérifie le nettoyage, le nombre de graphèmes et le résultat; `AdminAssetApiTests` vérifie les réponses HTTP aux bornes.
- Contrôle croisé du corpus le 28 octobre 2026, hors des applications : Node 24.13.0 (`Intl.Segmenter`, ICU 77.1, Unicode 16.0) et Swift 6.2.4 sur macOS 15.7.9 (`String.count`) donnent les 44 résultats attendus.
- Web et iOS : à consigner par leurs PR respectives.
