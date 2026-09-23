# Aegis — Cadrage institutionnel et direction visuelle

Date : 23 septembre 2026. Mode : découverte et cadrage.

## Statut des décisions

Philippe confirme la base institutionnelle et la navigation proposées, et
transmet les préférences de couleurs choisies avec Jimmy. Sont retenus : une
institution par déploiement P0, les sections ci-dessous, une identité bleu–indigo
partagée et les deux thèmes clair/sombre. Les anciennes maquettes ne sont pas
approuvées. Les détails de chaque écran, la police exacte, les tokens et les
rendus restent à soumettre à validation. Ce document précise le brief antérieur;
il ne valide pas automatiquement les fichiers `brief.md`, `states.md` ou
`directions.md` existants. Le nom du fichier ne vaut pas validation du
détail : seuls les éléments de ce paragraphe sont confirmés; le contenu des
tableaux et les puces de direction ci-dessous restent des propositions.

**Ajout du 23 septembre 2026 :** Philippe approuve la structure des sections
et les recommandations UX et produit de `sections.md` (détail et limites dans
son statut). Les champs d'API proposés C1 à C8, la police, les tokens et les
rendus ne sont pas approuvés. *Mise à jour : `09` v1.3 formalise P1, C1 (sous
une autre forme), C2, C3 et une partie de C4; C5 à C8 restent des
propositions (voir `sections.md`, statut et §9).*

**Sélection du 23 septembre 2026 :** Philippe retient le traitement A « Verre
lumineux » pour iOS et pour le Web (`prototype/`); B est conservé comme trace.
La police Web, les valeurs définitives des jetons et les libellés proposés
restent à valider.

## Institution et droits

Les comptes préparés accèdent au même déploiement et au même parc institutionnel.
La connexion ne demande pas de choisir une institution. Les autorisations sont
évaluées par le backend; un technicien ne devient pas administrateur et ne voit
pas les prêts privés de ses collègues. Aucune inscription publique, approbation
de connexion, adhésion ou invitation n'est ajoutée au P0. Le multi-institution
partagé est reporté, pas simplement caché dans l'interface.

## Sections retenues et contenu à détailler

| Plateforme / section | Contenu et action principale | Limite |
|---|---|---|
| iOS — Équipements | Rechercher, consulter un actif, comprendre sa readiness, réserver | Ne pas confondre visibilité et autorisation de retrait |
| iOS — Mon activité | Réservation active, annulation, retrait guidé, prêt, échéance et retour | QR contextuel; pas d'historique enrichi ajouté |
| iOS — Compte | Identité, rôle, niveau d'accès, déconnexion, préférence d'apparence | Pas de création d'institution ni d'auto-attribution de droits |
| Web — Vue d'ensemble | Anomalies, retards, disponibilité du casier; accès aux dossiers concernés | Pas de graphiques ou indicateurs commerciaux inventés |
| Web — Équipements | Modèles et exemplaires, calibration, état et accès requis | Respecter les contrats de gestion existants |
| Web — Réservations et prêts | Suivi, échéances et détails | Pas de fin de prêt manuelle sans preuve physique |
| Web — Casiers | Cellules, associations, observations et horaires | Ne pas ajouter une ouverture libre à distance |
| Web — Anomalies | Investigation et reconnaissance documentée | Pas de résolution arbitraire |
| Web — Audit | Filtres et chronologie corrélée | Historique non destructif |

La connexion précède la navigation. Proposition : le choix d'apparence Web
appartient au menu du compte, pas à une septième section métier. Les filtres
et détails précis restent des propositions à relier aux données réellement
exposées par l'API; ils sont détaillés dans `sections.md`, en attente de
validation. La colonne « Contenu » ci-dessus est elle aussi une proposition.

## Lecture des quatre références fournies

Les captures ont été fournies dans la conversation du 23 septembre; leurs URL
d'origine ne sont pas connues. Elles sont des références esthétiques, pas des
templates licenciés à intégrer ni des spécifications fonctionnelles. Les joindre
au prompt Claude; leurs chemins temporaires macOS ne sont pas des références
durables du dépôt.

| Référence | Principes à transposer | Éléments à ne pas reprendre |
|---|---|---|
| 1 — Fractal Glass, Mobile App Concept | Bleu profond vers bleu lumineux puis blanc; profondeur optique; respiration | Texte minuscule, interface artistique abstraite, distorsion des informations utiles |
| 2 — Enterprise reporting sombre | Structure latérale Web, regroupements modulaires, panneaux légèrement translucides et contours fins | Rapports financiers, chatbot IA, accumulation de métriques et fond perturbant les données |
| 3 — Glassmorphism Analytics Dashboard clair | Surfaces claires teintées, arrondis, hiérarchie typographique, continuité avec le sombre | Faibles contrastes, graphiques gratuits, copie de la navigation du produit source |
| 4 — AI Agent Mobile App | Grands titres sans empattement, formes généreuses, contraste sombre/lumière, profondeur des surfaces | Orange comme couleur de marque, voix/chat/Web3, sphère animée décorative obligatoire |

La police de la référence 4 n'est pas identifiée avec certitude. Son caractère
recherché est moderne, sobre, sans empattement, avec de grands titres compacts
et un texte courant très lisible. Ne pas prétendre avoir identifié ou licencié
cette famille. Demander la source ou comparer deux candidates avec le même texte
français avant sélection, en vérifiant les droits d'utilisation.

## Direction : verre bleu–indigo

Confirmé : bleu, bleu profond et indigo, thèmes clair et sombre, formes
arrondies, verre mesuré. Les puces suivantes sont des règles de travail
proposées, non validées.

- Palette de marque : bleu, bleu profond et indigo/bleu violacé; aucune valeur
  hexadécimale n'a encore été choisie. Les couleurs de statut gardent leur sens
  propre et sont toujours accompagnées de texte ou de symboles.
- Clair : base blanc cassé ou légèrement bleutée, texte sombre, surfaces lisibles.
- Sombre : base bleu nuit, texte clair, lumière bleue ou indigo localisée.
- Verre : exprimer les couches de navigation et de regroupement; maintenir les
  formulaires, tableaux, erreurs et consignes sur des fonds suffisamment stables.
- Arrondis : généreux sur les grands conteneurs, adaptés à la densité des contrôles;
  ne pas transformer chaque information en carte ou chaque bouton en capsule.
- Typographie : partager les rôles et le caractère entre plateformes sans imposer
  une police Web à tous les contrôles natifs iOS. Tester accents, chiffres,
  identifiants, longs motifs de blocage et tailles de texte agrandies.
- Fluidité : transitions courtes qui expliquent navigation, sélection et retour
  d'action. Aucun effet ne retarde le scan ou ne simule une confirmation physique.
- Accessibilité : thèmes complets, contraste mesuré sur le fond réellement rendu,
  focus visible, Dynamic Type, VoiceOver et navigation clavier; repli opaque et
  mouvement réduit. Ne pas déclarer l'accessibilité vérifiée depuis une image.

## Prochaine passe et critères de validation

1. Faire valider une fiche par section : objectif, informations, actions, détails,
   états, règles d'accès et correspondance avec les contrats. Ne pas redemander
   la décision mono-institution déjà prise.
2. Corriger les incohérences documentées : readiness prête sur un actif emprunté;
   instruction d'ouvrir prématurée à `AUTHORIZED`; code technique obligatoire dans
   les libellés; statut « validé » sans approbation humaine. *Corrigé le
   23 septembre dans `brief.md`, `states.md` et `directions.md`; les SVG
   antérieurs sont marqués non approuvés et remplacés, sans être redessinés.*
3. Après validation des fiches, comparer deux traitements de cette même identité,
   sur les mêmes écrans et les mêmes données : catalogue iOS avec actif bloqué et
   liste Web avec détail d'actif. Montrer chaque traitement en clair et sombre.
   Ne pas revenir à trois concepts fonctionnels sans rapport entre eux.
4. Après sélection, compléter les parcours et leur handoff : composants, tokens,
   textes français, comportements, états défavorables et preuves visuelles.

Les rendus doivent être inspectés aux dimensions d'usage, pas seulement sur une
affiche de présentation. Les limites de l'environnement et les contrôles non
exécutés doivent être indiqués. Aucun code applicatif, dépendance, commit ou push
n'est autorisé par ce brief.
