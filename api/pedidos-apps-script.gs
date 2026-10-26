/**
 * Apps Script de pedidos de la tienda La Peregrina (va pegado en la planilla "Pedidos tienda La Peregrina").
 *
 * - doPost: recibe cada pedido aprobado desde el servidor de la tienda, lo agrega a la hoja "Pedidos"
 *   y manda los mails (confirmación al cliente y aviso interno).
 * - doPost con tipo 'arrepentimiento': registra el pedido de arrepentimiento (hoja "Arrepentimientos") y manda el código por mail.
 * - doGet: el panel de envíos. Solo lo pueden abrir cuentas @laperegrina.ar.
 *
 * La dirección de la implementación pública funciona como contraseña: no la publiques.
 */
const CLAVE = '';                              // opcional: si la completás, poné la misma en Render (PEDIDOS_CLAVE)
const REMITENTE = 'info@laperegrina.ar';       // desde dónde salen los mails (tiene que ser un alias de la cuenta)
const AVISAR_A = 'info@laperegrina.ar';        // a quién le llegan los avisos de pedidos nuevos
const DOMINIO = 'laperegrina.ar';              // quién puede abrir el panel
const PANEL_URL = '';                          // dirección del panel (se completa después de implementarlo)
const SITIO = 'https://laperegrina.ar';
const HOJA_ID = '';                            // id de la planilla si el script no está dentro de ella

const COL = { fecha: 1, pedido: 2, pago: 3, modo: 4, estado: 5, productos: 6, frascos: 7, total: 8, envio: 9,
  costo: 10, nombre: 11, email: 12, tel: 13, dni: 14, direccion: 15, localidad: 16, cp: 17, seguimiento: 18,
  enviado: 19, items: 20 };
const ENCABEZADO = ['Fecha', 'Pedido', 'Pago MP', 'Modo', 'Estado', 'Productos', 'Frascos', 'Total', 'Envío', 'Costo envío',
  'Nombre', 'Email', 'Teléfono', 'DNI', 'Dirección', 'Localidad', 'CP', 'Seguimiento', 'Enviado el', 'Items'];

/* ---------------- Recepción de pedidos ---------------- */

function doPost(e) {
  const data = JSON.parse((e.postData && e.postData.contents) || '{}');
  if (CLAVE && data.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
  if (data.tipo === 'arrepentimiento') return salida(arrepentimiento(data.solicitud || {}));
  const p = data.pedido;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);                         // evita filas duplicadas si Mercado Pago avisa dos veces a la vez
  try {
  const hoja = hojaPedidos();
  const ids = hoja.getLastRow() > 1 ? hoja.getRange(2, COL.pago, hoja.getLastRow() - 1, 1).getValues().flat().map(String) : [];
  if (ids.indexOf(String(p.pago_id)) === -1) {
    const c = p.cliente || {};
    hoja.appendRow([new Date(p.fecha || Date.now()), p.pedido, String(p.pago_id), p.modo, 'Por enviar',
      p.items.map(i => i.cantidad + ' × ' + i.producto).join('\n'), p.items.reduce((a, i) => a + i.cantidad, 0),
      p.total, p.envio, p.costo_envio, c.nombre, c.email, c.tel, c.dni,
      [c.direccion, c.depto].filter(Boolean).join(' '), c.localidad, c.cp, '', '', JSON.stringify(p.items)]);
    try { mailCliente(p); } catch (err) { console.error('mail cliente', err); }
    try { mailInterno(p); } catch (err) { console.error('mail interno', err); }
  }
  } finally { lock.releaseLock(); }
  return salida({ ok: true });
}

function hojaPedidos() {
  const ss = HOJA_ID ? SpreadsheetApp.openById(HOJA_ID) : SpreadsheetApp.getActive();
  let h = ss.getSheetByName('Pedidos');
  if (!h) { h = ss.insertSheet('Pedidos'); h.appendRow(ENCABEZADO); h.setFrozenRows(1); return h; }
  // completa columnas nuevas si la hoja es de una versión anterior
  const n = h.getLastColumn();
  if (n < ENCABEZADO.length) h.getRange(1, n + 1, 1, ENCABEZADO.length - n).setValues([ENCABEZADO.slice(n)]);
  return h;
}

function salida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- Botón de arrepentimiento ---------------- */

function arrepentimiento(a) {
  if (!a.codigo || !a.email) return { ok: false, error: 'datos' };
  const ss = HOJA_ID ? SpreadsheetApp.openById(HOJA_ID) : SpreadsheetApp.getActive();
  let h = ss.getSheetByName('Arrepentimientos');
  if (!h) { h = ss.insertSheet('Arrepentimientos'); h.appendRow(['Fecha', 'Código', 'Pedido', 'Nombre', 'Email', 'Teléfono', 'Motivo', 'Estado']); h.setFrozenRows(1); }
  h.appendRow([new Date(a.fecha || Date.now()), a.codigo, a.pedido, a.nombre, a.email, a.tel, a.motivo, 'Pendiente']);
  const nombre = esc(String(a.nombre || '').split(' ')[0]);
  try {
    enviar(a.email, 'Recibimos tu solicitud de arrepentimiento · ' + a.codigo,
      'Recibimos tu solicitud de arrepentimiento. Código: ' + a.codigo + '. Te escribimos dentro de las 24 horas para coordinar el retiro de los productos y la devolución del dinero.',
      plantilla('Código de tu solicitud: ' + a.codigo,
        titulo('Botón de arrepentimiento', 'Recibimos tu solicitud, ' + nombre + '.') +
        '<p style="margin:0">Registramos tu pedido de arrepentimiento de la compra. Guardá este código: es el comprobante de tu solicitud.</p>' +
        caja('Código de la solicitud', '<b style="font-size:20px">' + esc(a.codigo) + '</b>') +
        (a.pedido ? caja('Pedido', esc(a.pedido)) : '') +
        '<p style="margin:22px 0 0">Te escribimos dentro de las 24 horas para coordinar el retiro de los productos. El envío de vuelta corre por nuestra cuenta y te devolvemos el dinero por el mismo medio de pago.</p>' +
        '<p style="margin:16px 0 0;font-size:14px;color:#7A5C70">La Gloria de la Peregrina SA · CUIT 30-71498097-8</p>'));
  } catch (err) { console.error('mail arrepentimiento', err); }
  try {
    enviar(AVISAR_A, 'Arrepentimiento ' + a.codigo + (a.pedido ? ' · pedido ' + a.pedido : ''),
      'Nueva solicitud de arrepentimiento ' + a.codigo + ' de ' + a.nombre + ' (' + a.email + '). Hay que responder dentro de las 24 horas.',
      plantilla('Nueva solicitud de arrepentimiento ' + a.codigo,
        titulo('Botón de arrepentimiento', esc(a.codigo)) +
        '<p style="margin:0"><b>Hay que contestarle al cliente dentro de las 24 horas</b> para coordinar el retiro y la devolución del dinero.</p>' +
        caja('Cliente', esc(a.nombre) + '<br>' + esc(a.email) + (a.tel ? '<br>' + esc(a.tel) : '')) +
        caja('Pedido', a.pedido ? esc(a.pedido) : 'No lo indicó') +
        (a.motivo ? caja('Motivo', esc(a.motivo)) : '')));
  } catch (err) { console.error('mail interno arrepentimiento', err); }
  return { ok: true, codigo: a.codigo };
}

/* ---------------- Mails ---------------- */

function enviar(para, asunto, texto, html) {
  const opts = { htmlBody: html, name: 'La Peregrina', replyTo: REMITENTE };
  if (GmailApp.getAliases().indexOf(REMITENTE) !== -1) opts.from = REMITENTE;
  GmailApp.sendEmail(para, asunto, texto, opts);
}

function pesos(n) { return '$' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function textoEnvio(p) {
  const c = p.cliente || {};
  if (p.envio === 'retiro') return 'Retiro en Mar del Plata. Te escribimos por WhatsApp para coordinar día y lugar.';
  return 'Andreani a ' + (p.envio === 'sucursal' ? 'sucursal' : 'domicilio') + ' · ' +
    [c.direccion, c.depto, c.localidad, c.cp ? 'CP ' + c.cp : ''].filter(Boolean).join(', ');
}

/** Plantilla común: encabezado ciruela con logo, cuerpo crema, pie con datos. */
function plantilla(previa, contenido) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>La Peregrina</title></head><body style="margin:0;padding:0;background:#EDE6DF">' +
  '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(previa) + '</div>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDE6DF"><tr><td align="center" style="padding:24px 12px">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#F6F1EC;border-radius:20px;overflow:hidden">' +
  '<tr><td align="center" style="background:#330323;padding:30px 24px 26px"><img src="' + SITIO + '/img/mail-logo.png" width="180" alt="La Peregrina" style="display:block;width:180px;height:auto;border:0"></td></tr>' +
  '<tr><td style="padding:34px 32px 30px;font-family:Raleway,Helvetica,Arial,sans-serif;color:#330323;font-size:16px;line-height:1.6">' + contenido + '</td></tr>' +
  '<tr><td style="background:#22011A;padding:22px 32px;font-family:Raleway,Helvetica,Arial,sans-serif;color:#D9CFC8;font-size:13px;line-height:1.6" align="center">' +
  'La Peregrina · Mermeladas y miel desde 1994 · Sierras de Mar del Plata<br>' +
  '<a href="' + SITIO + '" style="color:#FFDB84;text-decoration:none">www.laperegrina.ar</a> · ' +
  '<a href="mailto:' + REMITENTE + '" style="color:#FFDB84;text-decoration:none">' + REMITENTE + '</a></td></tr>' +
  '</table></td></tr></table></body></html>';
}

function titulo(kicker, texto) {
  return '<div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#B80F36">' + esc(kicker) + '</div>' +
    '<h1 style="margin:8px 0 14px;font-family:Fraunces,Georgia,\'Times New Roman\',serif;font-weight:500;font-size:34px;line-height:1.1;color:#330323">' + texto + '</h1>';
}

function tablaItems(p) {
  let filas = p.items.map(i => {
    const img = i.id ? SITIO + '/img/tienda/' + encodeURIComponent(i.id) + '-1-s.jpg' : '';
    return '<tr><td width="64" style="padding:10px 0;border-bottom:1px solid #E3D6CB">' +
      (img ? '<img src="' + img + '" width="48" height="60" alt="" style="display:block;width:48px;height:60px;object-fit:cover;border-radius:24px 24px 8px 8px;border:0">' : '') +
      '</td><td style="padding:10px 8px;border-bottom:1px solid #E3D6CB;font-size:15px"><b>' + esc(i.producto) + '</b><br><span style="color:#7A5C70">' + i.cantidad + ' × ' + pesos(i.precio) + '</span></td>' +
      '<td align="right" style="padding:10px 0;border-bottom:1px solid #E3D6CB;font-size:15px;white-space:nowrap"><b>' + pesos(i.cantidad * i.precio) + '</b></td></tr>';
  }).join('');
  filas += '<tr><td></td><td style="padding:10px 8px 2px;color:#7A5C70;font-size:15px">Envío</td><td align="right" style="padding:10px 0 2px;font-size:15px">' + (p.costo_envio ? pesos(p.costo_envio) : 'Sin cargo') + '</td></tr>';
  filas += '<tr><td></td><td style="padding:8px 8px 0;font-size:17px"><b>Total</b></td><td align="right" style="padding:8px 0 0;font-family:Georgia,serif;font-size:22px;color:#B80F36"><b>' + pesos(p.total) + '</b></td></tr>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px">' + filas + '</table>';
}

function caja(etiqueta, texto) {
  return '<div style="margin-top:18px;background:#FFFFFF;border-radius:14px;padding:16px 18px"><div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7A5C70">' +
    esc(etiqueta) + '</div><div style="margin-top:4px;font-size:15px;line-height:1.5">' + texto + '</div></div>';
}

function boton(url, texto) {
  return '<div style="margin-top:26px"><a href="' + url + '" style="display:inline-block;background:#B80F36;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:999px">' + esc(texto) + '</a></div>';
}

function mailCliente(p) {
  const c = p.cliente || {};
  if (!c.email) return;
  const prueba = p.modo === 'prueba' ? '[PRUEBA] ' : '';
  const html = plantilla('Recibimos tu pedido ' + p.pedido + '. Ya estamos armando tu caja.',
    titulo('Pedido ' + p.pedido, '¡Gracias por tu compra, ' + esc((c.nombre || '').split(' ')[0]) + '!') +
    '<p style="margin:0">Recibimos tu pago y ya estamos armando tu caja. Te avisamos por mail cuando la despachemos.</p>' +
    tablaItems(p) + caja('Entrega', esc(textoEnvio(p))) +
    '<p style="margin:22px 0 0;font-size:14px;color:#7A5C70">¿Tenés alguna duda? Respondé este mail o escribinos por WhatsApp al +54 9 223 696-5902.</p>' +
    boton(SITIO + '/tienda/', 'Volver a la tienda'));
  enviar(c.email, prueba + '¡Gracias por tu compra! Pedido ' + p.pedido, 'Recibimos tu pedido ' + p.pedido + '. Total: ' + pesos(p.total) + '. ' + textoEnvio(p), html);
}

function mailInterno(p) {
  const c = p.cliente || {};
  const prueba = p.modo === 'prueba' ? '[PRUEBA] ' : '';
  const html = plantilla('Nuevo pedido ' + p.pedido + ' · ' + pesos(p.total),
    titulo('Nuevo pedido', esc(p.pedido)) +
    '<p style="margin:0"><b>' + esc(c.nombre) + '</b> · ' + esc(c.tel) + ' · ' + esc(c.email) + ' · DNI ' + esc(c.dni) + '</p>' +
    tablaItems(p) + caja('Entrega', esc(textoEnvio(p))) +
    (PANEL_URL ? boton(PANEL_URL, 'Abrir el panel de envíos') : ''));
  enviar(AVISAR_A, prueba + 'Nuevo pedido ' + p.pedido + ' · ' + pesos(p.total), 'Nuevo pedido ' + p.pedido + ' de ' + c.nombre + '. Total ' + pesos(p.total), html);
}

function mailEnviado(p, seguimiento) {
  const c = p.cliente || {};
  if (!c.email) return;
  const prueba = p.modo === 'prueba' ? '[PRUEBA] ' : '';
  const retiro = p.envio === 'retiro';
  const html = plantilla(retiro ? 'Tu caja ya está lista para retirar.' : 'Tu caja ya está en camino.',
    titulo('Pedido ' + p.pedido, retiro ? '¡Tu caja está lista!' : '¡Tu caja está en camino!') +
    '<p style="margin:0">' + (retiro ? 'Ya podés pasar a retirarla. Te escribimos por WhatsApp para coordinar.' : 'Despachamos tu pedido con Andreani.') + '</p>' +
    (seguimiento ? caja('Número de seguimiento', '<b style="font-size:18px">' + esc(seguimiento) + '</b><br><a href="https://www.andreani.com" style="color:#B80F36">Seguilo en andreani.com</a>') : '') +
    tablaItems(p) + caja('Entrega', esc(textoEnvio(p))));
  enviar(c.email, prueba + (retiro ? 'Tu caja está lista para retirar · ' : 'Tu caja está en camino · ') + p.pedido,
    (retiro ? 'Tu pedido está listo para retirar. ' : 'Tu pedido fue despachado. ') + (seguimiento ? 'Seguimiento: ' + seguimiento : ''), html);
}

/* ---------------- Panel de envíos ---------------- */

function autorizado() {
  const mail = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return mail.slice(-(DOMINIO.length + 1)) === '@' + DOMINIO;
}

function doGet() {
  if (!autorizado()) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:40px">Este panel es solo para el equipo de La Peregrina. Entrá con tu cuenta @' + DOMINIO + '.</p>');
  return HtmlService.createHtmlOutputFromFile('Panel').setTitle('Envíos · La Peregrina')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function filaAPedido(f, i) {
  let items = [];
  try { items = JSON.parse(f[COL.items - 1] || '[]'); } catch (e) {}
  if (!items.length) items = String(f[COL.productos - 1] || '').split('\n').filter(Boolean).map(l => { const m = l.split(' × '); return { cantidad: Number(m[0]) || 1, producto: m[1] || l, precio: 0 }; });
  return { fila: i + 2, fecha: f[0] instanceof Date ? f[0].toISOString() : String(f[0]), pedido: f[1], modo: f[3], estado: f[4] || 'Por enviar',
    items: items, frascos: f[6], total: f[7], envio: f[8], costo_envio: f[9],
    cliente: { nombre: f[10], email: f[11], tel: String(f[12]), dni: String(f[13]), direccion: f[14], localidad: f[15], cp: String(f[16]) },
    seguimiento: f[17], enviado: f[18] instanceof Date ? f[18].toISOString() : String(f[18] || '') };
}

function listarPedidos() {
  if (!autorizado()) throw new Error('Sin permiso');
  const h = hojaPedidos();
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, ENCABEZADO.length).getValues().map(filaAPedido).reverse();
}

function marcarEnviado(fila, seguimiento, avisar) {
  if (!autorizado()) throw new Error('Sin permiso');
  const h = hojaPedidos();
  const f = h.getRange(fila, 1, 1, ENCABEZADO.length).getValues()[0];
  const p = filaAPedido(f, fila - 2);
  h.getRange(fila, COL.estado).setValue('Enviado');
  h.getRange(fila, COL.seguimiento).setValue(seguimiento || '');
  h.getRange(fila, COL.enviado).setValue(new Date());
  if (avisar) mailEnviado(p, seguimiento);
  return true;
}

function deshacerEnviado(fila) {
  if (!autorizado()) throw new Error('Sin permiso');
  const h = hojaPedidos();
  h.getRange(fila, COL.estado).setValue('Por enviar');
  h.getRange(fila, COL.enviado).setValue('');
  return true;
}

/** Para probar desde el editor: muestra con qué direcciones puede mandar mails esta cuenta. */
function verAlias() { console.log('Cuenta: ' + Session.getEffectiveUser().getEmail() + ' · Alias: ' + JSON.stringify(GmailApp.getAliases())); }
