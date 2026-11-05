/* Symboles de statut (forme + glyphe) et glyphes d'interface, dessinés pour le prototype. */
(function () {
  var G = 'fill="none" stroke="var(--ag-glyph)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  var shapes = {
    octagon: '<path d="M6.5 1.5h7l5 5v7l-5 5h-7l-5-5v-7z" fill="currentColor"/>',
    diamond: '<path d="M10 1.2 18.8 10 10 18.8 1.2 10z" fill="currentColor"/>',
    circle: '<circle cx="10" cy="10" r="8.8" fill="currentColor"/>'
  };
  var glyphs = {
    bang: '<path d="M10 5.4v5.6" ' + G + '/><circle cx="10" cy="14.1" r="1.05" fill="var(--ag-glyph)"/>',
    clock: '<circle cx="10" cy="10" r="3.9" ' + G + '/><path d="M10 8v2.2l1.4.9" ' + G + '/>',
    offline: '<path d="M6.1 8.7a5.5 5.5 0 0 1 7.8 0M7.9 11.1a3 3 0 0 1 4.2 0" ' + G + '/><path d="M5.6 14.4 14.4 5.6" ' + G + '/>',
    person: '<circle cx="10" cy="7.7" r="1.9" ' + G + '/><path d="M6.4 13.9c.4-2.1 1.8-3.2 3.6-3.2s3.2 1.1 3.6 3.2" ' + G + '/>',
    info: '<circle cx="10" cy="6.1" r="1.05" fill="var(--ag-glyph)"/><path d="M10 9v5" ' + G + '/>',
    check: '<path d="m6.6 10.2 2.4 2.4 4.4-4.8" ' + G + '/>',
    minus: '<path d="M6.5 10h7" ' + G + '/>',
    question: '<path d="M7.9 7.8a2.2 2.2 0 1 1 3.3 1.9c-.8.5-1.2.9-1.2 1.8" ' + G + '/><circle cx="10" cy="14" r="1" fill="var(--ag-glyph)"/>'
  };
  var status = {
    error: ['octagon', 'bang'], warningClock: ['diamond', 'clock'], warningOffline: ['diamond', 'offline'],
    warningPerson: ['diamond', 'person'], info: ['circle', 'info'], infoClock: ['circle', 'clock'],
    ready: ['circle', 'check'], blocked: ['octagon', 'minus'], unknown: ['diamond', 'question'], neutral: ['circle', 'info']
  };
  function svgStatus(name) {
    var p = status[name];
    return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' + shapes[p[0]] + glyphs[p[1]] + '</svg>';
  }
  var ui = {
    back: '<path d="M15 12H5m5-5-5 5 5 5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    overview: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    equipment: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
    reservations: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4m6-4v4"/>',
    lockers: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h16"/>',
    anomalies: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4m0 3h.01"/>',
    audit: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>'
  };
  function svgUi(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ui[name] + '</svg>';
  }
  window.AEGIS_ICONS = { status: svgStatus, ui: svgUi };
})();
