# Revue du jeu d’illustrations du cahier — 23 septembre 2026

**Mode :** revue d’usage et de cohérence documentaire, avant intégration PDF.

**Périmètre :** travail de Claude dans `docs/design/asset-lifecycle/`, sans modification de ses fichiers.

**Verdict :** **REVISE**, pour des corrections ciblées de contrat et de préparation à l’impression; aucune nouvelle recherche de direction visuelle demandée.

## 1. Conclusion

Le traitement A constitue une base cohérente pour illustrer le cahier. Les
surfaces bleues et vitrées restent secondaires aux informations métier; iOS et
Web partagent une identité sans reprendre la même disposition. Les quatre
écrans mobiles et les trois vues Web suffisent à expliquer les parcours choisis.
Il n’est pas nécessaire de reprendre un programme de quarante rendus.

Les réserves ci-dessous empêchent seulement de qualifier le jeu actuel de
« parfaitement aligné sur le contrat » ou de le placer tel quel sur deux pages
A4. Elles ne remettent pas en cause le choix esthétique de Philippe.

## 2. Ce qui a été inspecté

- Les **13 images individuelles** : les huit pivots iOS 02 / Web 02 en A/B et
  clair/sombre, puis les cinq autres écrans en A/clair.
- Les **quatre planches** : deux comparaisons et les deux planches du cahier.
- Le manifeste, la fixture partagée, les compositions HTML, les correspondances
  d’états, les légendes et les documents de passation concernés.
- Les contrats REST révisés, les règles de retrait/retour et les décisions P0.

Les sept écrans distincts ont été inspectés aux dimensions prévues : iOS
393 × 852 logiques, rendu 786 × 1704; Web 1440 × 900. Aucun chevauchement
gênant n’a été observé dans ces images. Les tableaux Web et leurs inspecteurs
restent compréhensibles; les actions et les raisons de blocage ressortent.
Cette observation n’est pas une validation responsive ou sur appareil réel.

Points métier correctement représentés :

- A1 prêt et A2 bloqué pour calibration expirée au début du parcours;
- scanner explicitement simulé, sans secret opérationnel;
- accusé de commande distinct de la porte ouverte et du retrait confirmé;
- réservation honorée et prêt créé après confirmation physique;
- anomalie « actif présent avec prêt actif » sans clôture du prêt;
- reconnaissance avec note, sans bouton administratif de résolution forcée;
- instants successifs et états simultanés distingués dans les planches.

## 3. Corrections avant le commit des illustrations

### R1 — Remplacer le diagnostic administratif hypothétique

**Importance : élevée pour la cohérence du cahier.** La fixture contient encore
`adminDiagnostic.result: READY/BLOCKED` et le Web décrit un diagnostic « pour un
technicien habilité ». Le contrat [09, §8.9](../cahier-conception/09-contrats-rest.md)
définit maintenant `operationalDiagnostic { evaluatedAt, reasons }`, sans
technicien fictif ni résultat `READY` universel.

Corriger la fixture, `AG.status.adminDiagnostic`, les titres et explications de
Web 02, les légendes des planches et les documents de passation. Une liste vide
de raisons peut se présenter comme « Aucun empêchement détecté », sans promettre
un droit d’emprunt ou une ouverture. Les raisons non personnelles viennent du
serveur; le Web ne recalcule pas l’autorisation.

**Acceptation :** les rendus Web A/B, clair/sombre, et leurs planches reflètent
ce diagnostic; aucune readiness administrative ou permission universelle n’est
inventée. Retirer le marqueur de proposition seulement après cet alignement.

### R2 — Mettre à jour les contrats réellement acquis, sans tout ratifier

**Importance : moyenne, bloquante pour une passation fidèle.** Le retour de
Claude propose de retirer C1 et C4 parce que les résumés et la vue administrative
sont désormais définis. Cette conclusion est trop large.

| Élément | État réel du contrat | Ajustement attendu |
|---|---|---|
| C1, diagnostic | Défini par `AdminAssetView`, mais avec la sémantique de R1 | Remplacer la proposition; ne pas seulement enlever son étiquette |
| C1, identifiant RFID affiché | Non ajouté à `AdminAssetView` | Garder son statut illustratif distinct ou omettre ce détail |
| C2, horaire | `LockerStatusView.currentWindow` est défini | Aligner la fixture et les sources; quand `open=true`, `nextOpensAt=null`, contrairement à la fixture actuelle |
| C3, reprise | `currentOperationId` est défini | Mettre à jour `sections.md` : la dernière tentative peut être terminale tant que la ressource parente reste ouverte; `returnOperationId` reste réservé au retour confirmé |
| C4, résumés | `AssetSummary.model` est un objet, pas `modelName`; `UserSummary` est défini | Corriger la description des types |
| C4, nom du titulaire | Aucun champ `holder`/`user` enrichi n’a été ajouté à `LoanView`/`ReservationView` | Conserver le nom illustratif comme tel dans Web 03/04; l’existence d’un type ne crée pas un champ de réponse |
| C6 et forme des preuves | Aucune ratification globale par la révision REST | Conserver les réserves sur le libellé d’institution et la forme détaillée des preuves |

Mettre à jour `sections.md`, `jeu-cahier.md`, le README du prototype, les
métadonnées et les légendes concernées. La phrase du README indiquant que seul
10 h 30 est rendu est également dépassée. Les comparaisons A/B doivent rester
identifiables comme une trace exploratoire, pas comme un nouveau choix à demander.

**Acceptation :** les documents distinguent besoins approuvés, champs maintenant
normatifs et propositions restantes. Aucune nouvelle modification des contrats
REST ou MQTT n’est nécessaire pour clôturer cette passe d’illustration.

## 4. Intégration PDF : ne pas réduire les planches sans contrôle

**Risque élevé pour la lisibilité, à traiter lors de la mise en page.** La
planche iOS mesure 1800 × 1290 pixels; la planche Web 1640 × 1540, avec ses vues
Web déjà réduites à 50 %. À titre de calcul, une insertion sur 170 mm de largeur
ferait passer un texte iOS de 17 pixels logiques à environ **4,6 points** et un
texte Web de 14 pixels, réduit à moitié dans la planche, à environ **2,6 points**.
Ces valeurs ne sont pas des mesures d’un PDF exporté, mais signalent un problème
prévisible de réduction. Augmenter la résolution ne grossit pas les caractères.

Employer les **captures individuelles** pour les figures utiles : deux écrans
iOS par rangée au maximum, puis vérifier leur taille réelle; pour le Web, une
vue sur page paysage ou un ensemble vue générale + détail agrandi. Remettre les
légendes en vrai texte du document. Les planches peuvent servir d’aperçu, pas
être le seul support de lecture des consignes et preuves.

Ne pas générer de nouveaux parcours pour résoudre un problème de mise en page.
Le PDF devra être rendu et inspecté à sa taille de lecture avant remise.

## 5. Vérifications et limites

| Vérification observée | Résultat |
|---|---|
| Inspection visuelle des 17 PNG existants | Effectuée; réserves sémantiques R1/R2 et risque de réduction PDF ci-dessus |
| Manifeste, dimensions, présence des fichiers | 7 écrans construits, 13 PNG individuels et 4 planches conformes aux dimensions annoncées |
| Syntaxe JS et scripts intégrés; références locales littérales des HTML | Vérification Node réussie sur 10 HTML; ce contrôle ne prouve pas que chaque interaction fonctionne |
| Chronologie de la fixture | QR : 60 s dès création, 47 s restantes au scanner; fenêtre physique : 120 s après autorisation; confirmation avant expiration; échéance du prêt reprise de la réservation |
| Contrastes du script fourni | Aucun échec sur les paires de tokens et les échantillons PNG configurés; pas un audit exhaustif WCAG |
| Documentation modifiée du cahier | 16 fichiers contrôlés, 49 cibles locales existantes, 28 exemples JSON valides et clôture des blocs de code |
| Nomenclature | 29 lignes identiques à la fiche source; 714,02 $ d’articles et 860,94 $ d’enveloppe indicative; prix non relevés à nouveau |
| SQL du document 08 | Blocs SQL inchangés par rapport au commit de départ |
| `git diff --check` | Réussi |
| Validation de configuration agents | Réussie sans avertissement avec le Python fourni par Codex; le Python système ancien ne vérifie pas intégralement TOML |

Le script de contrastes a été exécuté avec une mémorisation **en mémoire** du
décodage PNG, sans modifier son fichier ni ses seuils. Cela évite que son
`setdefault` redécode la même image pour chaque point. Commande reproductible
depuis la racine :

```sh
python3 -u - <<'PY'
import functools
import runpy

checks = runpy.run_path('docs/design/asset-lifecycle/prototype/tools/contrast.py')
failures = checks['check_tokens']()
context = checks['check_samples'].__globals__
context['read_png'] = functools.lru_cache(maxsize=None)(context['read_png'])
failures += checks['check_samples']()
print('TOTAL FAILURES:', failures)
raise SystemExit(bool(failures))
PY
```

**Non vérifiés :** utilisation sur iPhone, Dynamic Type, VoiceOver, navigation
clavier réelle, focus modal, zoom Web, mouvement réduit, performance du flou,
thèmes sombres des cinq nouveaux écrans, rendu PDF final et matériel physique.
Les seuils de contraste sont ceux des [WCAG 2.2](https://www.w3.org/TR/WCAG22/);
réussir des échantillons ne démontre pas l’ensemble de cette norme.

Les fixtures sont des compositions illustratives, pas des réponses API prêtes
pour les tests d’intégration. En particulier, `AG.at` fusionne actuellement des
horodatages futurs dans certains instantanés antérieurs : ils ne sont pas
affichés comme accomplis dans les figures vérifiées, mais devront être corrigés
avant toute réutilisation comme fixtures contractuelles.

Avant développement, arrêter aussi une police Web distribuable et vérifier les
conditions de la famille retenue; le rendu local en SF Pro ne suffit pas à fixer
un choix multiplateforme. Voir les [ressources typographiques Apple](https://developer.apple.com/fonts/).

## 6. Suite bornée

1. Claude corrige R1/R2 dans son périmètre, régénère les images dépendantes et
   les inspecte. Aucun nouveau style ou écran n’est requis.
2. Les ajustements normatifs et cette revue sont committés séparément du jeu UI.
   Les modifications préexistantes de configuration des agents restent hors de
   ces commits tant que leur périmètre n’est pas vérifié séparément.
3. Claude commit le jeu UI vérifié, puis pousse la branche autorisée, sans
   écraser de travail distant ni intégrer une autre branche implicitement.
4. Identifier la branche et les fichiers 3D de Jimmy, puis préparer leur
   intégration avec les figures UI. Aucun modèle 3D n’a été évalué dans cette revue.
5. Actualiser la section UI du cahier, intégrer les illustrations et produire
   le PDF. L’ancienne illustration de §5.3 et les formulations de validation de
   §5.4 sont délibérément laissées pour cette intégration, pas validées comme finales.

La méthode des skills `aegis-core`, `aegis-contracts`, `aegis-product-design`,
`aegis-quality-gate` et `aegis-delivery` a servi à séparer qualité visuelle,
fidélité au domaine, preuves observées et éléments encore non démontrés.
