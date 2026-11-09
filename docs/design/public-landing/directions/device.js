/*
 * Drawn stand-in of the P0 locker for the static compositions (issue #153): one hub
 * module with its screen on top, two cell modules A1 and A2 below, each joined to the
 * hub by its own cable. Proportions follow the intent render of
 * docs/diagrams/architecture-physique (module 300 × 260 × 340 mm, hub in the same
 * format as the cells); nothing here is an approved dimension. Jimmy's render replaces
 * this drawing once it is received.
 *
 * window.aegisDevice(el, { state, labels, alt }) renders an inline SVG.
 *   state: 'idle' | 'qr' | 'verify' | 'open-a1' | 'confirmed' | 'result'
 *   labels: { screen, a1, a2 } callout texts, or false
 */
(function () {
  // Three-quarter front view: the front face is a plain rectangle, depth recedes up-right.
  var ZX = 0.46, ZY = -0.24
  function P(x, y, z) { return [x + z * ZX, -y + z * ZY] }
  function pts(list) { return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ') }
  function poly(list, cls) { return '<polygon class="' + cls + '" points="' + pts(list) + '"/>' }

  // Box at origin (ox, oy, oz) with width w (x), height h (y), depth d (z); front at oz.
  function box(ox, oy, oz, w, h, d) {
    var top = [P(ox, oy + h, oz), P(ox + w, oy + h, oz), P(ox + w, oy + h, oz + d), P(ox, oy + h, oz + d)]
    var side = [P(ox + w, oy, oz), P(ox + w, oy, oz + d), P(ox + w, oy + h, oz + d), P(ox + w, oy + h, oz)]
    var front = [P(ox, oy, oz), P(ox + w, oy, oz), P(ox + w, oy + h, oz), P(ox, oy + h, oz)]
    return poly(top, 'dv-top') + poly(side, 'dv-side') + poly(front, 'dv-front')
  }
  function rect(x, y, z, w, h, cls) { return poly([P(x, y, z), P(x + w, y, z), P(x + w, y + h, z), P(x, y + h, z)], cls) }
  function dot(x, y, z, r, cls) { var p = P(x, y, z); return '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + r + '"/>' }
  function text(x, y, z, s, cls) { var p = P(x, y, z); return '<text class="' + cls + '" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '">' + s + '</text>' }

  // QR-like block on the hub screen: a fixed decorative pattern, never a real code.
  var QR = ['1111111011', '1000001001', '1011101101', '1011101010', '1011101110', '1000001001', '1111111011', '0000000110', '1101011011', '0110100101']
  function qr(x, y, size) {
    var n = QR.length, c = size / n, out = ''
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (QR[r][k] === '1') out += rect(x + k * c, y + (n - 1 - r) * c, 0.3, c * .86, c * .86, 'dv-qr')
    return out
  }

  function screen(state, x, y, w, h) {
    var out = rect(x, y, 0.2, w, h, 'dv-screen'), p = 8
    if (state === 'qr') {
      out += qr(x + p, y + p, h - 2 * p)
      out += rect(x + h + 2, y + h - p - 7, 0.3, 30, 7, 'dv-screen-accent')
      out += rect(x + h + 2, y + h - p - 20, 0.3, w - h - p - 6, 4, 'dv-screen-line')
      out += rect(x + h + 2, y + h - p - 30, 0.3, w - h - p - 22, 4, 'dv-screen-line')
      out += rect(x + h + 2, y + p, 0.3, 40, 4, 'dv-screen-line')
    } else if (state === 'verify') {
      out += rect(x + p, y + h / 2 - 3, 0.3, w - 2 * p, 6, 'dv-screen-line')
      out += rect(x + p, y + h / 2 - 3, 0.3, (w - 2 * p) * .55, 6, 'dv-screen-accent')
      out += rect(x + p, y + h / 2 + 12, 0.3, (w - 2 * p) * .4, 4, 'dv-screen-line')
    } else if (state === 'open-a1' || state === 'confirmed' || state === 'result') {
      out += rect(x + p, y + h - p - 8, 0.3, 34, 8, 'dv-screen-accent')
      out += rect(x + p, y + h - p - 22, 0.3, w - 2 * p, 4, 'dv-screen-line')
      out += rect(x + p, y + h - p - 32, 0.3, (w - 2 * p) * .7, 4, 'dv-screen-line')
      if (state !== 'open-a1') out += dot(x + w - p - 10, y + p + 10, 0.3, 6, 'dv-ok')
    } else {
      out += rect(x + p, y + h - p - 5, 0.3, (w - 2 * p) * .5, 4, 'dv-screen-line')
      out += rect(x + p, y + h - p - 15, 0.3, (w - 2 * p) * .3, 4, 'dv-screen-line')
    }
    return out
  }

  function cell(ox, oy, w, h, d, id, open, led) {
    var out = box(ox, oy, 0, w, h, d)
    if (open) {
      // Compartment visible; the door swings out on its left hinge toward the viewer.
      out += rect(ox + 10, oy + 10, 0.1, w - 20, h - 20, 'dv-inside')
      out += rect(ox + 10, oy + 10, 0.2, 26, h - 20, 'dv-inside-shade')
      var hx = ox + 10, t = oy + h - 10, b = oy + 10
      var door = [P(hx, t, 0), P(hx, b, 0), [hx - 118, -b + 58], [hx - 118, -t + 58]]
      out += poly(door, 'dv-door-open')
      out += poly([[hx - 118 + 10, -b + 58 - 10], [hx - 118 + 10, -t + 58 + 10], [hx - 10, -t + 8], [hx - 10, -b - 8]], 'dv-door-open-inner')
    } else {
      out += rect(ox + 10, oy + 10, 0.1, w - 20, h - 20, 'dv-door')
      out += rect(ox + w - 34, oy + h * .3, 0.2, 7, h * .4, 'dv-handle')
    }
    out += text(ox + 22, oy + h - 30, 0.3, id, 'dv-label')
    out += dot(ox + w - 22, oy + h - 24, 0.3, 5, led === 'ready' ? 'dv-led-ready' : led === 'blocked' ? 'dv-led-blocked' : 'dv-led-off')
    return out
  }

  // Cable from the hub's rear port down to a cell's rear port (both behind the modules).
  function cable(x1, y1, z1, x2, y2, z2) {
    var a = P(x1, y1, z1), b = P(x2, y2, z2)
    return '<path class="dv-cable" d="M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) + ' C' + (a[0] + 90).toFixed(1) + ',' + (a[1] + 30).toFixed(1) + ' ' + (b[0] + 90).toFixed(1) + ',' + (b[1] - 40).toFixed(1) + ' ' + b[0].toFixed(1) + ',' + b[1].toFixed(1) + '"/>'
  }

  function callout(p, dx, dy, label) {
    var x2 = p[0] + dx, y2 = p[1] + dy, anchor = dx < 0 ? 'end' : 'start'
    return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5"/>' +
      '<line x1="' + p[0].toFixed(1) + '" y1="' + p[1].toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>' +
      '<line x1="' + x2.toFixed(1) + '" y1="' + y2.toFixed(1) + '" x2="' + (x2 + (dx < 0 ? -28 : 28)).toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>' +
      '<text x="' + (x2 + (dx < 0 ? -34 : 34)).toFixed(1) + '" y="' + (y2 + 5).toFixed(1) + '" text-anchor="' + anchor + '">' + label + '</text>'
  }

  window.aegisDevice = function (el, opts) {
    opts = opts || {}
    var state = opts.state || 'idle'
    var W = 300, H = 340, D = 260, GAP = 6
    var a1Open = state === 'open-a1'
    var a1Led = state === 'confirmed' || state === 'result' ? 'ready' : 'off'
    var hx = (2 * W + GAP) / 2 - W / 2, hy = H + 4
    var out = ''
    out += '<ellipse class="dv-floor" cx="' + (W + GAP / 2 + D * ZX / 2 - 30).toFixed(1) + '" cy="' + (-D * ZY / 2 + 8).toFixed(1) + '" rx="' + (W + 70) + '" ry="44"/>'
    out += cable(hx + W - 20, hy + 60, D, W + GAP - 30, 60, D)
    out += cable(hx + W - 10, hy + 40, D, 2 * W + GAP - 30, 60, D)
    out += cell(0, 0, W, H, D, 'A1', a1Open, a1Led)
    out += cell(W + GAP, 0, W, H, D, 'A2', false, 'blocked')
    out += box(hx, hy, 0, W, H, D)
    out += rect(hx + 10, hy + 10, 0.1, W - 20, H - 20, 'dv-door')
    out += screen(state, hx + 30, hy + H - 170, 170, 124)
    out += rect(hx + W - 62, hy + H * .38, 0.2, 22, 22, 'dv-handle-sq')
    out += text(hx + W - 118, hy + H - 48, 0.3, 'AEGIS', 'dv-wordmark')
    out += dot(hx + W - 22, hy + H - 24, 0.3, 5, 'dv-led-off')

    var labels = ''
    if (opts.labels) {
      var l = opts.labels
      labels = '<g class="dv-callouts">' +
        callout(P(hx + 30 + 170, hy + H - 170 + 62, 0), 150, -60, l.screen || 'Écran du hub : QR, consignes, résultat') +
        callout(P(44, H - 60, 0), -40, 120, l.a1 || 'Cellule A1 · un câble dédié') +
        callout(P(W + GAP + 150, 34, 0), 140, 90, l.a2 || 'Cellule A2 · un câble dédié') + '</g>'
    }
    // Wide box for long callouts, tight box for short or no callouts.
    var viewBox = opts.viewBox || (opts.labels ? (opts.labels.a1 ? '-200 -775 1000 880' : '-320 -775 1280 880') : '-40 -775 760 880')
    el.innerHTML = '<svg viewBox="' + viewBox + '" role="img" aria-label="' + (opts.alt || 'Casier Aegis : un hub avec écran au-dessus de deux cellules A1 et A2, chacune reliée au hub par son propre câble') + '">' +
      '<style>' +
      '.dv-front{fill:var(--dv-face-front);stroke:var(--dv-edge);stroke-width:1.2;stroke-linejoin:round}' +
      '.dv-side{fill:var(--dv-face-side);stroke:var(--dv-edge);stroke-width:1.2;stroke-linejoin:round}' +
      '.dv-top{fill:var(--dv-face-top);stroke:var(--dv-edge);stroke-width:1.2;stroke-linejoin:round}' +
      '.dv-door{fill:none;stroke:var(--dv-seam);stroke-width:1.4}' +
      '.dv-door-open{fill:var(--dv-face-top);stroke:var(--dv-edge);stroke-width:1.2;stroke-linejoin:round}' +
      '.dv-door-open-inner{fill:none;stroke:var(--dv-seam);stroke-width:1.2}' +
      '.dv-inside{fill:var(--dv-face-side)}.dv-inside-shade{fill:var(--dv-edge);opacity:.4}' +
      '.dv-handle{fill:var(--ag-accent);opacity:.9}.dv-handle-sq{fill:var(--dv-seam)}' +
      '.dv-screen{fill:var(--dv-screen);stroke:var(--dv-edge);stroke-width:1.2}' +
      '.dv-screen-line{fill:var(--dv-screen-ink);opacity:.5}.dv-screen-accent{fill:var(--ag-accent-text)}' +
      '.dv-qr{fill:var(--dv-screen-ink)}.dv-ok{fill:var(--ag-ready-icon)}' +
      '.dv-label{font:500 24px var(--ag-font-mono);fill:var(--ag-text-2);letter-spacing:.04em}' +
      '.dv-wordmark{font:500 13px var(--ag-font-mono);fill:var(--ag-text-3);letter-spacing:.42em}' +
      '.dv-led-off{fill:var(--dv-seam)}.dv-led-ready{fill:var(--ag-ready-icon)}.dv-led-blocked{fill:var(--ag-blocked-icon)}' +
      '.dv-cable{fill:none;stroke:var(--ag-text-3);stroke-width:7;stroke-linecap:round;opacity:.75}' +
      '.dv-floor{fill:var(--dv-floor)}' +
      '.dv-callouts text{font:500 21px var(--ag-font-sans);fill:var(--ag-text)}' +
      '.dv-callouts line{stroke:var(--ag-text-3);stroke-width:1.2}.dv-callouts circle{fill:var(--ag-accent-text)}' +
      '</style>' + out + labels + '</svg>'
  }
})()
