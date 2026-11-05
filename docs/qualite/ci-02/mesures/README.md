# Outils de mesure xcresult (CI-02, #67)

`xcresult_mesures.py` reproduit les mesures de
[diagnostic-duree-ios.md](../diagnostic-duree-ios.md) à partir d'un bundle
`standalone.xcresult` ou `pr.xcresult` téléchargé depuis l'artefact `ios-test-results` d'un run (`ios-standalone-results` avant le 4 novembre 2026).
La CI ne l'exécute pas ; ses tests (`.github/scripts/tests/test_xcresult_mesures.py`)
tournent avec ceux des scripts CI.

## Environnement

Python 3.12 ou plus récent, dans un environnement virtuel dédié. `zstandard` n'est
nécessaire qu'à la commande `phases`, qui décompresse les journaux de session :

```bash
python3 -m venv ~/.venvs/aegis-xcresult
```

```bash
~/.venvs/aegis-xcresult/bin/pip install zstandard==0.25.0
```

## Utilisation

Extraire l'artefact dans un dossier neuf, puis, depuis la racine du dépôt :

```bash
~/.venvs/aegis-xcresult/bin/python -I docs/qualite/ci-02/mesures/xcresult_mesures.py phases <dossier>/standalone.xcresult
```

| Commande | Mesure |
|---|---|
| `phases` | durée par phase de l'action xcodebuild : compilation, démarrage, installation, tests unitaires, fenêtre UI ; lancements de l'app |
| `audits` | fenêtre de chaque audit d'accessibilité, avec le temps des requêtes de traitement des constats |
| `ui-tests` | temps par test UI et par type d'activité : lancement, attente, requête, tap, écarts non couverts |

## Garanties

Le bundle est une donnée non fiable : il provient d'un artefact de run.

- Le bundle et chaque fichier lu doivent exister. Un fichier qu'un lien symbolique
  ferait sortir du bundle est refusé.
- La base SQLite est ouverte par une URI `file:` construite avec `Path.as_uri()`, en
  `mode=ro&immutable=1`. Aucune base n'est créée, et aucun journal ni verrou n'est
  écrit dans le bundle.
- Aucun chemin reçu en argument n'est ajouté à `sys.path`.
- Codes de sortie :
  - `0` : mesure complète ;
  - `2` : bundle absent, invalide ou illisible, échec de décompression, ou schéma
    inattendu ;
  - `3` : profil incomplet, avec la liste des phases absentes sur la sortie d'erreur.

  Un échec n'imprime jamais de bilan partiel présenté comme valide.
