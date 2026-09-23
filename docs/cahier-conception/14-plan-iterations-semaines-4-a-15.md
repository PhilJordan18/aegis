# Aegis — Plan d’itérations des semaines 4 à 15

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Point de départ :** mercredi 23 septembre 2026, semaine 4
**Version :** 1.0 — plan de rattrapage soutenable

---

## 1. Combien d’itérations reste-t-il?

Le plan combine deux cadences :

- **3 macro-itérations du cours**, chacune couvrant quatre semaines : semaines 4–7, 8–11 et 12–15;
- **11 cycles hebdomadaires de production**, des semaines 4 à 14;
- la **semaine 15** est réservée à la présentation et à la contingence, pas à une nouvelle fonctionnalité.

Cette organisation permet de rester aligné avec le cours tout en obtenant un feedback chaque mercredi. En comptant la semaine de présentation, il reste 12 semaines calendaires; en pratique, seulement 11 itérations de travail.

---

## 2. Capacité garantie

Hypothèses explicitement connues :

- 7 heures communes et productives le mercredi, selon l’horaire de 9 h à 12 h et de 13 h à 17 h;
- 2 personnes pendant cette plage, donc **14 heures-personnes**;
- Philippe ajoute **4 heures hors cours par semaine**;
- aucun temps supplémentaire de Jimmy n’est compté tant qu’il ne l’a pas engagé;
- les fins de semaine restent un buffer volontaire, jamais une dépendance du chemin critique.

| Période | Calcul | Capacité garantie |
|---|---:|---:|
| Une semaine | `7 h × 2 + 4 h` | 18 h-personnes |
| Semaines 4–12, avant gel | `9 × 18` | 162 h-personnes |
| Semaines 13–14, stabilisation | `2 × 18` | 36 h-personnes |
| Semaines 4–14 | `11 × 18` | 198 h-personnes |
| Semaine 15, démo/contingence | `1 × 18` | 18 h-personnes |
| Total jusqu’à la présentation | `12 × 18` | 216 h-personnes |

Si Jimmy engage lui aussi 4 heures hors cours chaque semaine, la capacité devient 22 h-personnes par semaine. Cette capacité supplémentaire doit d’abord absorber apprentissage, POC et dette, pas ajouter du P1.

### Allocation hebdomadaire recommandée

| Usage | Part | Sur 18 h-personnes |
|---|---:|---:|
| Stories planifiées | 70 % | environ 12,5 h |
| Tests, intégration et documentation | 20 % | environ 3,5 h |
| Imprévu et apprentissage | 10 % | environ 2 h |

Les story points restent relatifs. Ne pas annoncer une vélocité avant d’avoir observé deux cycles complets.

---

## 3. Objectifs des trois macro-itérations

| Macro-itération du cours | Semaines | Objectif de sortie | Démonstration de fin |
|---|---|---|---|
| Itération 1 | 4–7 | Réduire les risques et rendre un actif prêt/réservable | A1 `READY`, A2 bloqué; réservation valide; POC RFID et bus décidé |
| Itération 2 | 8–11 | Livrer la chaîne de possession complète | Retrait puis retour de bout en bout avec preuve physique ou simulateur fidèle |
| Itération 3 | 12–15 | Geler, durcir, mesurer et présenter | Refus/anomalie/doublon, 10+10 répétitions, documentation et démo maîtrisée |

---

## 4. Plan hebdomadaire recommandé

| Cycle | Semaine | Objectif principal | Stories / travaux visés | Porte de sortie |
|---:|---:|---|---|---|
| 1 | 4 | Fermer le cadrage et lancer le walking skeleton | Story Map; ADR logiciels; blueprint; FND-01; début FND-02; matériel POC commandé/disponible | Repo commun lance DB + broker + API santé |
| 2 | 5 | Identité et premiers POC | IAM-01/02; POC-01/02; simulateur heartbeat | Login/autorisation testés; premières mesures écrites |
| 3 | 6 | Catalogue, placement et décisions matérielles | CAT-01/02; CFG-01; fin POC RFID/bus | ADR-002/003 acceptés ou fallback déclenché |
| 4 | 7 | Présence, readiness et horaire | CFG-02; PHY-01/02; RDY-01/02 | A1 prêt, A2 bloqué, raisons cohérentes Web/iOS |
| 5 | 8 | Réservation robuste | RES-01/02; concurrence; expiration; UI mobile | Réserver/voir/annuler sans double réservation |
| 6 | 9 | Rail de commande IoT | IOT-01/02; outbox; ACK/rejet; suivi par polling | Une commande corrélée ouvre seulement A1 dans le simulateur ou hardware |
| 7 | 10 | Retrait de bout en bout | CHK-01/02; LOAN-01 | Preuve physique crée le prêt automatiquement |
| 8 | 11 | Retour de bout en bout | RET-01/02; mise à jour Web/iOS | Preuve physique termine le prêt automatiquement |
| 9 | 12 | Cas négatifs et gel fonctionnel | ANO-01; AUD-01; QUA-01; sécurité critique | P0 gelé; aucune nouvelle capacité après la revue |
| 10 | 13 | Stabilisation et observabilité | Tests d’intégration, erreurs réseau, redémarrage, performance, procédures | Aucun défaut bloquant connu sur le scénario de démo |
| 11 | 14 | Répétabilité et répétition générale | DEM-01; 10 retraits + 10 retours; docs finales; répétition par les deux membres | Résultats consignés, démo exécutable par Philippe et Jimmy |
| — | 15 | Présentation et contingence | Correctifs bloquants seulement; préparation de l’environnement | Démonstration finale; aucune feature nouvelle |

### Règles d’ajustement

- Si le POC RFID échoue, le fallback devient immédiatement une story P0 et aucune tentative UHF supplémentaire non time-boxée ne repousse le calendrier.
- Si le bus hub-cellules échoue, le locker monolithique conserve les mêmes identifiants, contrats et comportements.
- Si un cycle déborde, retirer d’abord du polish ou une capacité P1; ne pas enlever les tests d’invariants.
- Les semaines 13–14 ne sont pas une réserve cachée pour terminer des fonctionnalités normales.

---

## 5. Plan concret des sept heures de la semaine 4

Les sept heures communes représentent 14 h-personnes. Le résultat attendu le 23 septembre est une base approuvée et un squelette fonctionnel commencé, pas une journée entière de discussion.

| Heure | Travail commun ou parallèle | Livrable observable |
|---|---|---|
| 0:00–0:45 | Valider la Story Map, les quatre tranches et le P0 | Backlog ordonné; P1/P2 écartés |
| 0:45–1:30 | Arbitrer ADR-001, 004, 005, 006, 007 et 008 | Statuts et conséquences approuvés ou questions nommées |
| 1:30–2:15 | Revoir le blueprint avec Jimmy; préparer les POC et composants | Schéma annoté; critères et propriétaires POC |
| 2:15–2:30 | Choisir les deux stories actives et leurs critères | Tableau de travail avec WIP = 2 |
| 2:30–5:00 | Travail parallèle : environnement/infra et squelette API | PostgreSQL + broker + API santé démarrables |
| 5:00–6:00 | Intégrer les branches et exécuter les tests ensemble | Une version commune reproductible |
| 6:00–7:00 | Démo interne, journal du jour, décisions et prochain cycle | Journal de semaine 4, résultats de commandes, prochaine priorité |

Une répartition possible pendant le bloc parallèle :

- personne A : Docker Compose, PostgreSQL, broker, configuration externe;
- personne B : squelette Spring Boot, Flyway et endpoint santé;
- intégration commune avant de quitter, sans conserver deux versions incompatibles.

Les rôles peuvent être inversés; chaque changement doit être relu par l’autre membre.

---

## 6. Cadence de chaque cycle hebdomadaire

### Avant mercredi

- Philippe utilise ses deux blocs de 2 heures sur la story déjà priorisée;
- une question bloquante est écrite dans l’issue au lieu d’attendre le cours;
- le code est poussé sur une branche courte et les commandes de test sont notées.

### Mercredi

1. 15 minutes : état du système, pas un long compte rendu;
2. 15 minutes : objectif du cycle et WIP maximal de deux;
3. travail parallèle sur des fichiers distincts;
4. intégration au moins une fois avant la dernière heure;
5. 30 minutes finales : tests, mini-démo, journal et prochain engagement.

### Fin de cycle

- compter uniquement les stories entièrement `Done`;
- noter capacité prévue, capacité réelle, points terminés et cause du report;
- mettre à jour le backlog sans modifier silencieusement le scope;
- démontrer une tranche intégrée, pas seulement des fichiers séparés.

---

## 7. Tableau de suivi minimal

```markdown
## Cycle [numéro] — Semaine [numéro]

### Objectif
[Une phrase démontrable]

### Capacité
- Mercredi en équipe : 14 h-personnes
- Philippe hors cours : 4 h
- Jimmy hors cours confirmé : [0 ou valeur]
- Absences/contraintes :

### Engagement
| Story | Propriétaire | Réviseur | Points | État |
|---|---|---|---:|---|

### Preuves
- Commandes/tests exécutés :
- Démo obtenue :
- Mesures POC :

### Bilan
- Terminé :
- Reporté et pourquoi :
- Risques :
- Décisions/ADR :
- Première priorité du prochain cycle :
```

---

## 8. Limites de travail en cours

- WIP maximal : deux stories, une par personne.
- Une migration Flyway donnée n’a qu’un seul propriétaire à la fois.
- Un fichier n’est pas modifié en parallèle par deux agents ou deux humains.
- Les contrats sont révisés avant l’implémentation qui les change.
- Une branche doit rester courte et intégrable; revue croisée avant fusion.
- Aucun agent ne commit, push, merge, change le scope ou accepte un ADR sans autorisation humaine explicite.

---

## 9. Seuils d’alerte

Une revue de portée immédiate est nécessaire si :

- aucune décision RFID ou hub/cellules n’est prise à la fin de la semaine 6;
- la readiness complète n’est pas démontrable à la fin de la semaine 7;
- le checkout n’est pas démontrable à la fin de la semaine 10;
- le retour n’est pas démontrable à la fin de la semaine 11;
- une fonctionnalité P1 est en cours alors qu’un de ces jalons P0 manque;
- les semaines 13–14 commencent avec une migration ou un contrat essentiel encore instable.

Dans ce cas, la réponse normale est de déclencher le fallback prévu, réduire le polish et concentrer l’équipe sur une tranche verticale complète — pas d’ajouter des heures non soutenables comme seule stratégie.
