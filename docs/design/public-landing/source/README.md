# Source du casier pour la landing

`casier-aegis-l-01.html` est la scène three.js de Jimmy, reçue le 9 novembre 2026
(SHA-256 de l'original `898a444b85cca41f…`). Elle est la référence visuelle du
casier pour la landing publique (#153); le dossier
`docs/diagrams/architecture-physique/rendu-3d/` de Jimmy n'est pas modifié.

Trois retouches d'en-tête, sans effet sur le modèle, répondent à l'analyse
SonarCloud de la PR : `lang="fr"` sur `<html>`, fermeture de `<head>` déplacée
après `<title>` et les métadonnées (l'original les plaçait dans `<body>`), et
attributs `integrity` + `crossorigin` sur les deux scripts CDN (three r128 et
OrbitControls 0.128.0). Le reste du fichier est identique à l'original.

La page n'embarque pas cette scène : `../verify/render-device.mjs` en tire des
images fixes dans `../assets/device/` en patchant une copie (fond transparent,
écran neutre, voyants pilotés, inscription « L-01 » retirée, alimentation masquée).
Toute retouche du modèle se fait dans ce fichier source, puis on relance le script.
