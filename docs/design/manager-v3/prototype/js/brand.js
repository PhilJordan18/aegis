/* Composant de marque unique et remplaçable : symbole (assets/aegis-core-mark*.svg) + « aegis » en Geist + produit.
   Quand le designer livrera les signatures vectorisées, seul ce composant change. */
(function () {
  var A = '../../identite/assets/';
  window.AEGIS_BRAND = {
    mark: function (size) {
      return '<span class="ag-mark" style="--s:' + size + 'px" aria-hidden="true">' +
        '<img class="ag-only-light" src="' + A + 'aegis-core-mark.svg" alt="" width="64" height="64">' +
        '<img class="ag-only-dark" src="' + A + 'aegis-core-mark-dark.svg" alt="" width="64" height="64"></span>';
    },
    link: function (opts) { // opts : size, label, href, product
      var product = opts.product === false ? '' : '<span class="ag-brand__app">' + opts.app + '</span>';
      return '<a class="ag-brand" href="' + (opts.href || 'index.html') + '" aria-label="' + opts.label + '">' + this.mark(opts.size || 30) +
        '<span class="ag-brand__word" aria-hidden="true">aegis</span>' + product + '</a>';
    }
  };
})();
