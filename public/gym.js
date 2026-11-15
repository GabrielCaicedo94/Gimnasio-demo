// Búsqueda en vivo: envía el formulario 300 ms después de dejar de escribir.
(function () {
  var q = document.getElementById('buscar');
  if (q) {
    var t;
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { q.form.submit(); }, 300); });
    // dejar el cursor al final del texto tras recargar
    if (q.value) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  // Al elegir un plan: autocompleta el monto con su precio.
  var plan = document.getElementById('plan_id'), monto = document.getElementById('monto');
  if (plan && monto) {
    var ini = document.getElementById('fecha_inicio'), hint = document.getElementById('hint-inicio');
    var poner = function () {
      var o = plan.options[plan.selectedIndex];
      if (o && o.dataset.precio) monto.value = o.dataset.precio;
      if (o && ini) {
        // Pase diario (1 día): vale solo hoy. Membresía: continúa tras el vencimiento actual.
        var diario = o.dataset.dias === '1';
        ini.value = diario ? ini.dataset.hoy : ini.dataset.sugerido;
        if (hint) hint.textContent = diario ? 'Hoy (el pase diario vale solo hoy).' : ini.dataset.hint;
      }
    };
    plan.addEventListener('change', poner);
    if (!monto.value) poner();
  }

  // Comprobante: obligatorio si el método no es efectivo; vista previa del archivo elegido.
  var metodo = document.getElementById('metodo'), bloque = document.getElementById('bloque-comprobante');
  if (metodo && bloque) {
    var ajustar = function () {
      var ef = metodo.value === 'efectivo';
      bloque.classList.toggle('d-none', ef);
      var ref = document.getElementById('bloque-ref'); if (ref) ref.classList.toggle('d-none', ef);
    };
    metodo.addEventListener('change', ajustar); ajustar();
  }
  document.querySelectorAll('input[type=file][data-preview]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var out = document.getElementById(inp.dataset.preview);
      if (!out) return;
      var f = inp.files[0];
      // Limpiar el otro input (solo se envía uno)
      document.querySelectorAll('input[type=file][data-preview]').forEach(function (o) { if (o !== inp) o.value = ''; });
      if (!f) { out.innerHTML = ''; return; }
      out.textContent = '';
      if (f.type.indexOf('image/') === 0) {
        var img = document.createElement('img'); img.src = URL.createObjectURL(f); img.className = 'img-thumbnail mt-2'; img.style.maxHeight = '160px';
        out.appendChild(img);
      }
      var s = document.createElement('div'); s.className = 'text-muted fs-13 mt-1';
      s.textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' KB'; out.appendChild(s);
    });
  });

  // Tema claro / oscuro (se recuerda en este navegador)
  var tema = document.getElementById('tema-toggle');
  if (tema) tema.addEventListener('click', function () {
    var h = document.documentElement;
    var t = h.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    h.setAttribute('data-bs-theme', t);
    try { localStorage.setItem('gym-tema', t); } catch (e) { /* sin almacenamiento: solo dura esta visita */ }
  });
})();

// Reduce las fotos en el navegador antes de subirlas (ahorra espacio y tiempo por la red local)
document.addEventListener('change', function (ev) {
  var inp = ev.target;
  if (!inp.matches || !inp.matches('input[type=file][data-reducir]') || !inp.files || !inp.files[0]) return;
  var f = inp.files[0], max = parseInt(inp.getAttribute('data-reducir'), 10) || 1600;
  var enviar = function () { if (inp.hasAttribute('data-enviar')) inp.form.submit(); };
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || typeof DataTransfer === 'undefined') return enviar();
  var img = new Image(), url = URL.createObjectURL(f);
  img.onload = function () {
    var k = Math.min(1, max / Math.max(img.width, img.height));
    if (k >= 1 && f.size < 1.5e6) { URL.revokeObjectURL(url); return enviar(); }
    var c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(function (b) {
      URL.revokeObjectURL(url);
      if (b) {
        var dt = new DataTransfer();
        dt.items.add(new File([b], 'foto.jpg', { type: 'image/jpeg' }));
        inp.files = dt.files;
        inp.dispatchEvent(new Event('gym-reducida', { bubbles: true }));
      }
      enviar();
    }, 'image/jpeg', 0.85);
  };
  img.onerror = function () { URL.revokeObjectURL(url); enviar(); };
  img.src = url;
}, true);

// Webcam de la laptop: "Tomar foto" abre una ventana con la cámara si el navegador la permite.
// En el celular (o sin webcam / sin permiso) cae a la cámara del teléfono o al selector de archivos.
document.addEventListener('click', function (ev) {
  var inp = ev.target;
  if (!inp.matches || !inp.matches('input[type=file][data-camara]') || inp.dataset.sinWebcam) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
  ev.preventDefault();
  var cerrar = function () {};
  var caer = function () { inp.dataset.sinWebcam = '1'; cerrar(); inp.click(); };
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (stream) {
    var ov = document.createElement('div'); ov.className = 'gym-cam';
    ov.innerHTML = '<div class="gym-cam-box"><video autoplay playsinline muted></video><div class="gym-cam-bar">' +
      '<button type="button" class="btn btn-primary" data-a="cap"><i class="ti ti-camera"></i> Capturar</button>' +
      '<button type="button" class="btn btn-light" data-a="cerrar">Cancelar</button></div></div>';
    document.body.appendChild(ov);
    var v = ov.querySelector('video'); v.srcObject = stream;
    cerrar = function () { stream.getTracks().forEach(function (t) { t.stop(); }); if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'cerrar') return cerrar();
      if (!v.videoWidth) return;
      var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob(function (b) {
        cerrar(); if (!b) return;
        var dt = new DataTransfer(); dt.items.add(new File([b], 'foto.jpg', { type: 'image/jpeg' }));
        inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
      }, 'image/jpeg', 0.9);
    });
  }).catch(caer);
}, true);

// Ampliar foto al hacer clic
document.addEventListener('click', function (ev) {
  var im = ev.target;
  if (!im.matches || !im.matches('img[data-ampliar]')) return;
  var ov = document.createElement('div'); ov.className = 'gym-cam'; ov.style.cursor = 'zoom-out';
  ov.innerHTML = '<img alt="Foto" style="max-width:100%;max-height:92vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.5)">';
  ov.firstChild.src = im.src;
  var cerrar = function () { document.removeEventListener('keydown', esc); if (ov.parentNode) ov.parentNode.removeChild(ov); };
  var esc = function (e) { if (e.key === 'Escape') cerrar(); };
  ov.addEventListener('click', cerrar); document.addEventListener('keydown', esc);
  document.body.appendChild(ov);
});

// Confirmaciones con ventana propia (reemplaza el cuadro gris del navegador)
document.addEventListener('submit', function (ev) {
  var f = ev.target;
  if (!f.hasAttribute || !f.hasAttribute('data-confirmar') || f.dataset.okConfirmado) return;
  ev.preventDefault();
  var peligro = f.dataset.tipo === 'peligro';
  var ov = document.createElement('div'); ov.className = 'gym-modal';
  ov.innerHTML = '<div class="gym-modal-box" role="dialog" aria-modal="true">' +
    '<div class="gym-modal-ico ' + (peligro ? 'peligro' : 'aviso') + '"><i class="ti ' + (peligro ? 'ti-alert-triangle' : 'ti-help-circle') + '"></i></div>' +
    '<h5 class="gym-modal-msg"></h5><div class="gym-modal-bar">' +
    '<button type="button" class="btn btn-light" data-a="no">Cancelar</button>' +
    '<button type="button" class="btn ' + (peligro ? 'btn-danger' : 'btn-primary') + '" data-a="si"></button></div></div>';
  ov.querySelector('.gym-modal-msg').textContent = f.dataset.confirmar;
  ov.querySelector('[data-a=si]').textContent = f.dataset.boton || 'Aceptar';
  var cerrar = function () { document.removeEventListener('keydown', tecla); if (ov.parentNode) ov.parentNode.removeChild(ov); };
  var tecla = function (e) { if (e.key === 'Escape') cerrar(); };
  ov.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    if (e.target === ov || (b && b.dataset.a === 'no')) return cerrar();
    if (b && b.dataset.a === 'si') { f.dataset.okConfirmado = '1'; cerrar(); f.submit(); }
  });
  document.addEventListener('keydown', tecla);
  document.body.appendChild(ov);
  ov.querySelector('[data-a=no]').focus();
}, true);

// Menú lateral: en pantallas grandes se oculta/muestra; en celular se abre encima del contenido
(function () {
  var h = document.documentElement, ancho = function () { return window.matchMedia('(min-width: 992px)').matches; };
  try { if (ancho() && localStorage.getItem('gym-menu') === 'oculto') h.classList.add('menu-oculto'); } catch (e) {}
  document.addEventListener('click', function (e) {
    if (e.target.closest('.sidenav-toggle-button')) {
      if (ancho()) { var o = h.classList.toggle('menu-oculto'); try { localStorage.setItem('gym-menu', o ? 'oculto' : 'visible'); } catch (x) {} }
      else h.classList.toggle('menu-abierto');
    } else if (e.target.closest('.sidenav-close, .sidenav-backdrop') || (!ancho() && e.target.closest('.side-nav-link'))) h.classList.remove('menu-abierto');
  });
})();
