# Source du casier pour la landing

`casier-aegis-l-01.html` est la scène three.js de Jimmy, reçue le 9 novembre 2026
et conservée **telle que reçue** (SHA-256 `898a444b85cca41f…`). Elle est la
référence visuelle du casier pour la landing publique (#153); le dossier
`docs/diagrams/architecture-physique/rendu-3d/` de Jimmy n'est pas modifié.

La page n'embarque pas cette scène : `../verify/render-device.mjs` en tire des
images fixes dans `../assets/device/` en patchant une copie (fond transparent,
écran neutre, voyants pilotés, inscription « L-01 » retirée, alimentation masquée).
Toute retouche du modèle se fait dans ce fichier source, puis on relance le script.
