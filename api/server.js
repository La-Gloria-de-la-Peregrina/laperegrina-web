// Servidor de la tienda La Peregrina.
// - POST /api/checkout  → valida el carrito con los precios de catalogo.json y crea el pago en Mercado Pago.
// - POST /api/webhook   → Mercado Pago avisa los pagos; se consulta el pago y, si está aprobado, se registra el pedido.
// - GET  /api/salud     → para comprobar que el servidor está andando.
// Variables de entorno (se cargan en Render, nunca en el código):
//   MP_ACCESS_TOKEN   Access Token de Mercado Pago (de prueba o de producción)
//   PEDIDOS_URL       URL del Apps Script que guarda el pedido en la planilla y manda los mails
//   PEDIDOS_CLAVE     clave compartida con ese Apps Script
//   SITIO             https://laperegrina.ar
//   API_URL           la dirección pública de este servidor (para el aviso de Mercado Pago)
const http = require('http');
const crypto = require('crypto');
const CAT = require('./catalogo.json');

const PORT = process.env.PORT || 3000;
const SITIO = (process.env.SITIO || 'https://laperegrina.ar').replace(/\/$/, '');
const API_URL = (process.env.API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.MP_ACCESS_TOKEN || '';
const ORIGENES = [SITIO, SITIO.replace('://', '://www.'), 'http://localhost:8000'];
const procesados = new Set(); // pagos ya registrados (evita duplicados si MP avisa dos veces)

function zona(cp) {
  cp = parseInt(cp, 10);
  if (!cp || cp < 1000 || cp > 9999) return null;
  if (cp >= 7600 && cp <= 7609) return 'mdp';
  if (cp < 2000) return 'amba';
  return 'resto';
}
function limpio(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max || 120); }

function responder(res, code, data, origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8' };
  if (origin && ORIGENES.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  res.writeHead(code, h); res.end(JSON.stringify(data));
}
function leer(req) {
  return new Promise((ok, mal) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 50000) { mal(new Error('muy grande')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { mal(e); } });
  });
}
async function mp(path, opts) {
  const r = await fetch('https://api.mercadopago.com' + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, (opts && opts.headers) || {})
  }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Mercado Pago ' + r.status + ': ' + (j.message || JSON.stringify(j)));
  return j;
}

async function checkout(body) {
  const items = body.items || {};
  const lineas = [];
  let cant = 0, subtotal = 0;
  for (const slug of Object.keys(items)) {
    const p = CAT.productos[slug], q = Math.floor(Number(items[slug]));
    if (!p || !(q > 0) || q > 60) throw { code: 400, msg: 'Producto o cantidad inválida.' };
    cant += q; subtotal += p.precio * q;
    lineas.push({ id: slug, title: p.nombre + ' · frasco 390 g', quantity: q, unit_price: p.precio, currency_id: 'ARS' });
  }
  if (cant < CAT.minimo) throw { code: 400, msg: 'La compra mínima es de ' + CAT.minimo + ' frascos.' };
  const envio = ['domicilio', 'sucursal', 'retiro'].includes(body.envio) ? body.envio : null;
  if (!envio) throw { code: 400, msg: 'Elegí un tipo de envío.' };
  const c = body.cliente || {};
  const cliente = { nombre: limpio(c.nombre), email: limpio(c.email), tel: limpio(c.tel, 40), dni: limpio(c.dni, 15),
    direccion: limpio(c.direccion), depto: limpio(c.depto, 40), localidad: limpio(c.localidad, 80), cp: limpio(body.cp, 8) };
  if (!cliente.nombre || !/^\S+@\S+\.\S+$/.test(cliente.email) || !cliente.tel) throw { code: 400, msg: 'Faltan datos de contacto.' };
  let costoEnvio = 0;
  if (envio !== 'retiro') {
    const z = zona(cliente.cp); if (!z) throw { code: 400, msg: 'Código postal inválido.' };
    if (envio === 'domicilio' && (!cliente.direccion || !cliente.localidad)) throw { code: 400, msg: 'Falta la dirección de entrega.' };
    costoEnvio = CAT.envio[z][envio];
  }
  const pedido = 'LP-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const pref = {
    items: lineas,
    payer: { name: cliente.nombre, email: cliente.email },
    shipments: { cost: costoEnvio, mode: 'not_specified' },
    external_reference: pedido,
    statement_descriptor: 'LA PEREGRINA',
    back_urls: { success: SITIO + '/tienda/gracias/?estado=ok', pending: SITIO + '/tienda/gracias/?estado=pendiente', failure: SITIO + '/tienda/gracias/?estado=error' },
    auto_return: 'approved',
    metadata: { pedido, envio, cliente: JSON.stringify(cliente) }
  };
  if (API_URL) pref.notification_url = API_URL + '/api/webhook';
  const r = await mp('/checkout/preferences', { method: 'POST', body: JSON.stringify(pref) });
  return { pedido, url: r.init_point, total: subtotal + costoEnvio };
}

async function registrar(pagoId) {
  if (procesados.has(pagoId)) return;
  const pago = await mp('/v1/payments/' + encodeURIComponent(pagoId));
  if (pago.status !== 'approved') return;
  procesados.add(pagoId);
  const md = pago.metadata || {};
  let cliente = {}; try { cliente = JSON.parse(md.cliente || '{}'); } catch (e) {}
  const items = ((pago.additional_info || {}).items || []).map(i => ({ producto: i.title, cantidad: Number(i.quantity), precio: Number(i.unit_price) }));
  const pedido = { pedido: pago.external_reference, pago_id: String(pago.id), fecha: pago.date_approved, total: pago.transaction_amount,
    envio: md.envio, costo_envio: (pago.shipping_amount || 0), items, cliente, modo: pago.live_mode ? 'real' : 'prueba' };
  console.log('Pedido aprobado', pedido.pedido, pedido.total);
  if (process.env.PEDIDOS_URL) {
    const r = await fetch(process.env.PEDIDOS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: process.env.PEDIDOS_CLAVE || '', pedido }) });
    if (!r.ok) { procesados.delete(pagoId); throw new Error('Planilla ' + r.status); }
  }
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') {
      const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
      if (ORIGENES.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
      res.writeHead(204, h); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/salud') return responder(res, 200, { ok: true, mp: !!TOKEN, planilla: !!process.env.PEDIDOS_URL }, origin);
    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      if (!TOKEN) return responder(res, 503, { error: 'La tienda todavía no está conectada a Mercado Pago.' }, origin);
      const body = await leer(req);
      return responder(res, 200, await checkout(body), origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/webhook') {
      const body = await leer(req).catch(() => ({}));
      const tipo = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
      const id = (body.data && body.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id');
      responder(res, 200, { ok: true }); // MP necesita respuesta rápida
      if (tipo === 'payment' && id) registrar(String(id)).catch(e => console.error('webhook', e.message));
      return;
    }
    responder(res, 404, { error: 'No encontrado' }, origin);
  } catch (e) {
    if (e && e.code) return responder(res, e.code, { error: e.msg }, origin);
    console.error(e);
    responder(res, 500, { error: 'No pudimos iniciar el pago. Probá de nuevo en unos minutos.' }, origin);
  }
}).listen(PORT, () => console.log('API tienda escuchando en', PORT));
