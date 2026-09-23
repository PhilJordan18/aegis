/*
 * Screen manifest — read by index.html, compare.html and tools/render.py.
 * Keep the JSON between the two markers valid JSON (render.py parses it).
 *
 * status: "built" (HTML exists and is rendered) | "deferred" (kept for a later pass;
 *         the 40-screen programme was cancelled on 2026-09-23 — nothing is built
 *         or linked for these entries).
 * treatments/themes (optional): restrict rendering. Phase-2 notebook screens are
 *         treatment A, light only (A selected on 2026-09-23). Phase-1 pivots
 *         (no restriction) keep A/B × light/dark as the comparison trace.
 * mocks: mock markers that appear on the screen (legend in compare.html, cahier.html).
 * Render path: renders/<platform>/<treatment>/<theme>/<n>-<slug>.png
 */
window.AEGIS_SCREENS =
/*JSON-START*/
[
  {"id": "ios-01", "platform": "ios", "n": "01", "slug": "connexion", "title": "Connexion", "moment": "10:29", "phase": 2, "status": "deferred", "mocks": []},
  {"id": "ios-02", "platform": "ios", "n": "02", "slug": "catalogue", "title": "Catalogue d'équipements", "moment": "10:30", "phase": 1, "status": "built", "mocks": []},
  {"id": "ios-03", "platform": "ios", "n": "03", "slug": "detail-reserver", "title": "Détail d'équipement — feuille « Réserver »", "moment": "10:31", "phase": 2, "status": "built", "treatments": ["a"], "themes": ["light"], "mocks": []},
  {"id": "ios-04", "platform": "ios", "n": "04", "slug": "mon-activite", "title": "Mon activité — réservation active", "moment": "10:32", "phase": 2, "status": "deferred", "mocks": []},
  {"id": "ios-05", "platform": "ios", "n": "05", "slug": "retrait-scanner", "title": "Retrait guidé — scanner contextuel (simulation)", "moment": "10:39", "phase": 2, "status": "built", "treatments": ["a"], "themes": ["light"], "mocks": ["SIM"]},
  {"id": "ios-06", "platform": "ios", "n": "06", "slug": "pret-actif", "title": "Mon activité — prêt actif", "moment": "10:43", "phase": 2, "status": "built", "treatments": ["a"], "themes": ["light"], "mocks": []},
  {"id": "web-01", "platform": "web", "n": "01", "slug": "vue-ensemble", "title": "Vue d'ensemble opérationnelle", "moment": "11:20", "phase": 2, "status": "deferred", "mocks": ["C4", "C6"]},
  {"id": "web-02", "platform": "web", "n": "02", "slug": "equipements", "title": "Gestion des équipements — inspecteur ouvert", "moment": "10:30", "phase": 1, "status": "built", "mocks": ["C6"]},
  {"id": "web-03", "platform": "web", "n": "03", "slug": "reservations-prets", "title": "Réservations et prêts — onglet Prêts", "moment": "11:20", "phase": 2, "status": "built", "treatments": ["a"], "themes": ["light"], "mocks": ["C4", "C6"]},
  {"id": "web-04", "platform": "web", "n": "04", "slug": "anomalie", "title": "Détail d'anomalie — dialogue « Reconnaître »", "moment": "11:20", "phase": 2, "status": "built", "treatments": ["a"], "themes": ["light"], "mocks": ["C4", "C6", "F"]}
]
/*JSON-END*/
;

window.AEGIS_VIEWPORTS = {
  ios: { width: 393, height: 852, scale: 2, note: "iPhone 16, points logiques, rendu 2×" },
  web: { width: 1440, height: 900, scale: 1, note: "1440 × 900 px CSS, rendu 1×, identique pour tous les écrans Web" }
};

window.AEGIS_TREATMENTS = {
  a: { name: "A — Verre lumineux", short: "A · Verre lumineux" },
  b: { name: "B — Opérationnel précis", short: "B · Opérationnel précis" }
};

/*
 * Mock legend (09 v1.3). C1 (operationalDiagnostic §8.9), C2 (currentWindow §8.6)
 * and C3 (currentOperationId §8.3–8.4) are normative now and carry no marker.
 */
window.AEGIS_MOCK_LEGEND = {
  C4: "Nom du titulaire illustratif : non exposé par LoanView ni ReservationView (holderUserId / userId seulement; UserSummary défini en §8.8 sans y être ajouté)",
  C6: "Libellé d'institution optionnel : proposition C6, absent de 09 v1.3",
  F: "Forme non définie par 09 (ici : détail des preuves normalisées, §18.1)",
  SIM: "Simulation : code de démonstration non fonctionnel, aucun jeton réel"
};
