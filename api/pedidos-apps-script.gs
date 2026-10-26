/**
 * Apps Script de pedidos de la tienda La Peregrina.
 * Va pegado en una planilla de Google (Extensiones → Apps Script).
 * Recibe cada pedido aprobado desde el servidor de la tienda, lo agrega a la hoja "Pedidos"
 * y manda dos mails: uno a La Peregrina y la confirmación al cliente.
 *
 * La dirección de implementación de este script funciona como contraseña: no la publiques.
 */
const CLAVE = '';   // opcional: si la completás, poné la misma en Render (PEDIDOS_CLAVE)
const AVISAR_A = 'info@laperegrina.ar';                   // a quién le llegan los pedidos

function doPost(e) {
  const data = JSON.parse(e.postData.contents || '{}');
  if (CLAVE && data.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
  const p = data.pedido;
  const hoja = SpreadsheetApp.getActive().getSheetByName('Pedidos') || crearHoja();
  // evita duplicados si llega dos veces el mismo pago
  const ids = hoja.getRange(2, 3, Math.max(1, hoja.getLastRow() - 1), 1).getValues().flat().map(String);
  if (ids.indexOf(String(p.pago_id)) === -1) {
    const c = p.cliente || {};
    hoja.appendRow([new Date(p.fecha || Date.now()), p.pedido, String(p.pago_id), p.modo, 'Nuevo',
      p.items.map(i => i.cantidad + ' × ' + i.producto).join('\n'), p.items.reduce((a, i) => a + i.cantidad, 0),
      p.total, p.envio, p.costo_envio, c.nombre, c.email, c.tel, c.dni,
      [c.direccion, c.depto].filter(String).join(' '), c.localidad, c.cp]);
    mails(p);
  }
  return salida({ ok: true });
}

function crearHoja() {
  const h = SpreadsheetApp.getActive().insertSheet('Pedidos');
  h.appendRow(['Fecha', 'Pedido', 'Pago MP', 'Modo', 'Estado', 'Productos', 'Frascos', 'Total', 'Envío', 'Costo envío',
    'Nombre', 'Email', 'Teléfono', 'DNI', 'Dirección', 'Localidad', 'CP']);
  h.setFrozenRows(1);
  return h;
}

function mails(p) {
  const c = p.cliente || {};
  const lista = p.items.map(i => '• ' + i.cantidad + ' × ' + i.producto).join('\n');
  const envio = p.envio === 'retiro' ? 'Retiro en Mar del Plata (coordinamos por WhatsApp)'
    : 'Andreani a ' + p.envio + ' · ' + [c.direccion, c.depto, c.localidad, 'CP ' + c.cp].filter(String).join(', ');
  const prueba = p.modo === 'prueba' ? '[PRUEBA] ' : '';
  MailApp.sendEmail(AVISAR_A, prueba + 'Nuevo pedido ' + p.pedido + ' · $' + p.total,
    lista + '\n\nTotal: $' + p.total + '\nEnvío: ' + envio + '\n\nCliente: ' + c.nombre + ' · ' + c.tel + ' · ' + c.email + ' · DNI ' + c.dni);
  if (c.email) MailApp.sendEmail(c.email, prueba + '¡Gracias por tu compra! Pedido ' + p.pedido,
    'Hola ' + c.nombre + ',\n\nRecibimos tu pedido ' + p.pedido + ':\n\n' + lista + '\n\nTotal pagado: $' + p.total +
    '\nEnvío: ' + envio + '\n\nTe vamos a avisar cuando lo despachemos.\n\nLa Peregrina\nwww.laperegrina.ar',
    { name: 'La Peregrina', replyTo: AVISAR_A });
}

function salida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
