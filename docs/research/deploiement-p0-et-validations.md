# Aegis — Chemin de déploiement P0 et premières validations

**Date :** 23 septembre 2026. **Statut :** proposition de réalisation, non exécutée.
Cette fiche précise le déploiement local déjà prévu au cahier. Elle ne commande
aucun matériel, ne choisit pas de service payant et ne remplace aucun contrat.
La remise du cahier en semaine 4 n’attend pas l’exécution de ces essais.

## 1. Deux opérations différentes

**Installer le client iOS :** un Mac avec Xcode compile et signe Aegis Mobile,
puis l’installe sur les iPhone autorisés. **Déployer les services :** un ordinateur
accessible sur le réseau de démonstration héberge l’API, PostgreSQL et MQTT.
L’ordinateur des services peut être différent du Mac utilisé pour compiler.

Le téléphone n’héberge ni PostgreSQL ni le backend. L’installation d’une app
sur l’iPhone ne rend pas automatiquement l’API accessible.

## 2. Cible locale recommandée

| Élément | Où il s’exécute | Communication attendue |
|---|---|---|
| Aegis Mobile | iPhone réel, app installée depuis Xcode | HTTPS vers Aegis Control uniquement; QR lu avec la caméra |
| Aegis Manager | Navigateur du poste administrateur | HTTPS vers le service Web et l’API |
| Aegis Control | Ordinateur de démonstration, service dans Compose | PostgreSQL privé et broker MQTT |
| PostgreSQL | Même ordinateur, réseau interne des services | Pas de port de base publié vers le réseau du laboratoire |
| Broker MQTT | Même ordinateur, accès TLS autorisé au hub | Backend et hub, avec identités et ACL propres |
| Hub ESP32 | Prototype | Wi-Fi vers le broker; RS-485 vers les cellules |

Choisir un ordinateur dont la compatibilité avec Docker et les ressources ont
été vérifiées; ne pas présumer que le Mac personnel est le bon hôte. Le garder
alimenté et disponible pendant les essais. Le réseau du Cégep doit permettre les
échanges; à défaut, demander un réseau de laboratoire ou un routeur autorisé.
Ne pas acheter de routeur ni modifier le réseau institutionnel sans accord.

Les noms de services Compose ne sont résolus qu’au sein de leur réseau Docker.
L’iPhone utilise un nom ou une adresse de l’hôte accessible sur le LAN, pas
`localhost` ni le nom interne d’un conteneur. Publier seulement les points
d’entrée nécessaires et limiter le pare-feu au réseau autorisé. Le routage Web
et API sous une même origine est une option à retenir lors du bootstrap, sans
imposer ici un nouveau serveur intermédiaire. [Réseaux Compose](https://docs.docker.com/compose/how-tos/networking/)

## 3. Installation et confiance sur les iPhone

1. Relever les versions iOS et choisir un Mac/Xcode compatible, disponible à
   l’école; confirmer les droits d’installation sur les téléphones prêtés.
2. Utiliser une équipe de signature autorisée dans Xcode et installer une première
   app minimale sur le téléphone. Activer le mode développeur avec le propriétaire
   ou le responsable de l’appareil lorsque requis. [Mode développeur Apple](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/)
3. Une Personal Team permet des essais personnels avec des limites, notamment
   des profils expirant après sept jours. Vérifier le compte utilisable pour les
   appareils du cours et prévoir une réinstallation avant la démonstration si
   cette voie est retenue. L’App Store ou TestFlight ne sont pas nécessaires à
   cette proposition de test local. [Compte développeur Apple](https://developer.apple.com/help/account/basics/about-your-developer-account)
4. Prévoir la déclaration d’usage du réseau local (`NSLocalNetworkUsageDescription`)
   et traiter un refus de permission; cette permission ne remplace ni TLS ni la
   connexion au compte Aegis. La caméra demande sa propre autorisation pour le
   scan. [Réseau local Apple](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
5. Qualifier HTTPS et MQTT/TLS avec des certificats correspondant au nom ou à
   l’adresse réellement utilisés. Si une autorité de développement locale est
   retenue, faire approuver son installation sur les appareils; importer
   uniquement le certificat public de confiance, jamais sa clé privée. Sur iOS,
   un profil installé manuellement peut nécessiter une activation explicite de
   confiance TLS. Le hub doit aussi vérifier le certificat de son broker.
   [Confiance des certificats Apple](https://support.apple.com/en-us/102390)

Ne pas contourner une erreur TLS en acceptant tous les certificats, ni ajouter
une désactivation globale des protections réseau. Protéger les clés et mots de
passe hors Git. Si l’institution interdit les certificats locaux, choisir avec
son responsable un point d’entrée et une chaîne de confiance autorisés.

## 4. Ordre de validation pratique

| Étape | Preuve de sortie | Responsable proposé |
|---|---|---|
| Hôte et réseau | Machine identifiée; compatibilité de l’environnement et accès réseau autorisé vérifiés | Philippe, personnel du laboratoire si nécessaire |
| Installation iOS | App de test lancée sur chaque iPhone utilisé; signature et échéance connues | Philippe |
| Première connexion | App réelle et navigateur joignent l’API par HTTPS; mauvais certificat refusé | Philippe |
| Accès métier | Comptes préparés; bon rôle accepté, mauvais rôle refusé; même parc institutionnel | Philippe |
| Rail IoT | Hub réel joint le broker par TLS; identifiant erroné et sujet non autorisé refusés | Philippe et Jimmy |
| Intégration | Catalogue A1 prêt/A2 bloqué, puis parcours avec simulateur, enfin matériel | Équipe |
| Reprise de démo | Redémarrage des services sans perte d’historique, reconnexion des clients et du hub | Équipe |

Les commandes seront ajoutées quand elles auront été réellement exécutées. Avant
une répétition, préparer les données de démonstration dans un environnement
distinct; ne pas purger l’historique de possession pour masquer un problème.

## 5. Décisions logicielles retenues et preuves attendues

Philippe a approuvé ces choix le 23 septembre 2026. Le registre 13 et le contrat
REST 09 consignent la décision et ses détails; aucune exécution n’est revendiquée.

| Avant… | Décision retenue | Vérification de réalisation |
|---|---|---|
| La connexion réelle | ADR-007 : JWT signé de 60 min, sans renouvellement, Keychain iOS et mémoire Web | Documenter algorithme/gestion des clés; tester faux jeton, expiration, droits courants et reconnexion |
| La première commande persistée | ADR-004/005 : Mosquitto local, MQTT 3.1.1, QoS 1 critique, compte/secret par hub, TLS/ACL et outbox PostgreSQL | Configurer les identités distinctes; tester refus, doublons et interruptions avant/après publication par la tâche Spring |
| Le suivi d’une opération | ADR-006 : polling REST ciblé | Environ une seconde, une requête en vol, ralentissement sur erreur, pause en arrière-plan, reprise immédiate et arrêt au terminal |
| Le défi QR réel | ADR-009 : 60 s maximum dès création, 5 secrets erronés, 120 s physiques après autorisation | Mesurer l’affichage et le scan; qualifier le seuil configurable de préparations contre les rafales et les cycles normaux; l’ancien plafond de 3/15 min n’est plus retenu |
| Chaque écran consommateur | Contrat 09 : horaire serveur, référence de suivi et diagnostic administrateur non personnel | Tester les DTO, la reprise et les autorisations; les autres champs des maquettes ne deviennent pas normatifs |

Le squelette, les migrations initiales et le calcul de readiness peuvent avancer.
La validation logicielle ne vaut pas sélection définitive des composants,
qualification du réseau de l’école ou preuve de fonctionnement du montage.

## 6. POC à préparer avec Jimmy

Le but est de lever une incertitude matérielle, pas de construire six produits
distincts. Les nombres ci-dessous sont une **première campagne proposée**, à
valider avant exécution; ils ne sont ni des résultats ni une qualification
industrielle. Employer les fiches des composants et un banc de laboratoire
approprié pour fixer les limites électriques.

| POC | Première campagne proposée | Critère observable / décision |
|---|---|---|
| RFID par cellule | 10 lectures par condition et par cellule : actif attendu, cellule vide, tag voisin, tag extérieur; répéter les orientations et matériaux représentatifs | Aucune fausse attribution à la cellule attendue dans cette campagne; journaliser aussi les absences de lecture et le délai. Jimmy et Philippe fixent le délai et taux de lecture admissibles avant essai; sinon affiner ou activer le repli |
| Verrou et porte | 10 cycles commandés par cellule, puis démarrage et coupure d’alimentation; mesurer courant, durée et échauffement | Aucune impulsion au démarrage, état porte cohérent, respect des limites du composant et accès de secours; changer le pilote ou le verrou en cas d’écart |
| Alimentation et connectique | Inventaire des charges, bilan de puissance, contrôle hors tension des liaisons, puis mesures sous charge sur banc protégé | Brochage sans ambiguïté, tensions/courants/températures dans les limites documentées; aucune mise sous tension du montage final avant validation de ces limites |
| Deux liaisons RS-485 | 10 commandes ciblées par cellule; essais de doublon, message expiré, cellule déconnectée et redémarrage | Zéro action sur la mauvaise cellule et aucune seconde impulsion; défaut signalé sans fausse confirmation de présence |
| Écran et QR | 10 scans par iPhone en éclairage représentatif, puis essais code expiré, rejoué et mauvais compte | Scan possible dans la fenêtre autorisée; tous les cas invalides sont refusés; aucune ouverture à la simple préparation |
| Réseau et confiance | Connexion iPhone/API et hub/broker, redémarrage et interruption d’accès, certificats/identifiants invalides | Reconnexion maîtrisée, connexions non fiables refusées et état incertain signalé; utiliser un autre réseau autorisé si le réseau de classe ne convient pas |

Pour chaque essai : noter montage, version, condition, attendu, observation,
latence, échec et décision. La campagne de caractérisation ne remplace pas
l’acceptation finale déjà fixée à dix retraits et dix retours consécutifs.
