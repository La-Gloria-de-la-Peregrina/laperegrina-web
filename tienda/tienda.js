(function(){
var P=window.PRODUCTOS||{},KEY='lp_carrito';
function load(){try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(e){return window.__c||{};}}
function save(c){window.__c=c;try{localStorage.setItem(KEY,JSON.stringify(c));}catch(e){}}
var C=load();Object.keys(C).forEach(function(k){if(!P[k])delete C[k];});
function fmt(n){return '$'+Math.round(n).toLocaleString('es-AR');}
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function cant(){return Object.keys(C).reduce(function(a,k){return a+C[k];},0);}
function sub(){return Object.keys(C).reduce(function(a,k){return a+C[k]*P[k].p;},0);}
function setQ(k,q){q=Math.max(0,Math.min(24,q|0));if(q)C[k]=q;else delete C[k];save(C);pinta();}
function itemHTML(k){var p=P[k];return '<div class="t-item"><a href="'+p.u+'"><img src="'+p.img+'" alt=""></a><div><b>'+esc(p.n)+'</b><small>'+esc(p.l)+' · '+fmt(p.p)+'</small><div class="t-cant"><button type="button" data-q="'+k+'" data-d="-1" aria-label="Restar uno">−</button><input value="'+C[k]+'" data-qi="'+k+'" inputmode="numeric" aria-label="Cantidad"><button type="button" data-q="'+k+'" data-d="1" aria-label="Sumar uno">+</button></div></div><div style="text-align:right"><b>'+fmt(p.p*C[k])+'</b><button type="button" class="t-quitar" data-quitar="'+k+'">Quitar</button></div></div>';}
var n=document.getElementById('carro-n'),dr=document.getElementById('carro'),its=document.getElementById('carro-items');
function pinta(){var q=cant();if(n){n.textContent=q;n.hidden=!q;}
if(its){its.innerHTML=q?Object.keys(C).map(itemHTML).join(''):'<p class="t-mini" style="padding:24px 0">Todavía no agregaste productos.</p>';document.getElementById('carro-sub').textContent=fmt(sub());document.getElementById('carro-seguir').style.display=q?'':'none';}
chk();}
function abrir(){if(!dr)return;dr.hidden=false;document.body.style.overflow='hidden';var x=dr.querySelector('.t-x');x&&x.focus();}
function cerrar(){if(!dr)return;dr.hidden=true;document.body.style.overflow='';}
document.addEventListener('click',function(e){var t=e.target.closest('[data-agregar],[data-q],[data-quitar],[data-cerrar],#carro-btn,[data-filtro],.t-thumb,[data-menos],[data-mas]');if(!t)return;
if(t.id==='carro-btn'){abrir();return;}
if(t.hasAttribute('data-cerrar')){cerrar();return;}
if(t.hasAttribute('data-agregar')){var k=t.getAttribute('data-agregar'),q=1;if(t.hasAttribute('data-con-cant')){q=Math.max(1,parseInt(document.getElementById('t-cant').value,10)||1);}setQ(k,(C[k]||0)+q);var tx=t.textContent;t.classList.add('t-ok');t.textContent='✓ Agregado';setTimeout(function(){t.classList.remove('t-ok');t.textContent=tx;},1300);abrir();return;}
if(t.hasAttribute('data-q')){var k2=t.getAttribute('data-q');setQ(k2,(C[k2]||0)+parseInt(t.getAttribute('data-d'),10));return;}
if(t.hasAttribute('data-quitar')){setQ(t.getAttribute('data-quitar'),0);return;}
if(t.hasAttribute('data-menos')||t.hasAttribute('data-mas')){var i=document.getElementById('t-cant');i.value=Math.max(1,Math.min(24,(parseInt(i.value,10)||1)+(t.hasAttribute('data-mas')?1:-1)));return;}
if(t.hasAttribute('data-filtro')){var f=t.getAttribute('data-filtro');document.querySelectorAll('[data-filtro]').forEach(function(b){b.setAttribute('aria-pressed',b===t?'true':'false');});document.querySelectorAll('.t-catalogo .t-card').forEach(function(c){c.hidden=!(f==='todas'||c.getAttribute('data-linea')===f);});return;}
if(t.classList.contains('t-thumb')){document.getElementById('t-foto').src=t.getAttribute('data-foto');document.querySelectorAll('.t-thumb').forEach(function(b){b.setAttribute('aria-current',b===t?'true':'false');});}});
document.addEventListener('change',function(e){var k=e.target.getAttribute&&e.target.getAttribute('data-qi');if(k)setQ(k,parseInt(e.target.value,10)||0);if(e.target.name==='envio')chk();});
document.addEventListener('keydown',function(e){if(e.key==='Escape')cerrar();});
// checkout
var ENV=null;
function zona(cp){cp=parseInt(cp,10);if(!cp||cp<1000||cp>9999)return null;if(cp>=7600&&cp<=7609)return{domicilio:4500,sucursal:3600};if(cp<2000)return{domicilio:7400,sucursal:5900};return{domicilio:9800,sucursal:7600};}
function chk(){var box=document.getElementById('chk-items');if(!box)return;var q=cant();
box.innerHTML=Object.keys(C).map(itemHTML).join('');document.getElementById('chk-vacio').hidden=!!q;
var m=(document.querySelector('input[name=envio]:checked')||{}).value||'domicilio';
document.querySelectorAll('[data-dom]').forEach(function(l){l.style.display=m==='domicilio'?'':'none';});
var e=m==='retiro'?0:(ENV?ENV[m]:null);
document.getElementById('chk-sub').textContent=fmt(sub());document.getElementById('chk-env').textContent=e===null?'Ingresá tu CP':(e?fmt(e):'Sin cargo');
document.getElementById('chk-total').textContent=fmt(sub()+(e||0));
document.querySelectorAll('[data-costo]').forEach(function(el){el.textContent=ENV?fmt(ENV[el.getAttribute('data-costo')]):'—';});}
var cot=document.getElementById('chk-cotizar');
if(cot){cot.onclick=function(){var cp=document.getElementById('chk-cp').value.trim(),z=zona(cp),msg=document.getElementById('chk-cp-msg');
if(!z){msg.textContent='Ingresá un código postal de 4 números.';ENV=null;}else{ENV=z;msg.textContent='Costo estimado para CP '+cp+'. Vista previa: el costo real lo va a calcular Andreani.';}chk();};
document.getElementById('chk-pagar').onclick=function(){var msg=document.getElementById('chk-msg'),f=document.getElementById('chk-form'),m=(document.querySelector('input[name=envio]:checked')||{}).value,ok=true;
if(!cant()){msg.textContent='Agregá al menos un producto.';return;}
if(m!=='retiro'&&!ENV){msg.textContent='Calculá el envío con tu código postal.';return;}
[].forEach.call(f.querySelectorAll('input'),function(i){var need=i.required||(m==='domicilio'&&(i.name==='direccion'||i.name==='localidad'));var bad=need&&!i.value.trim()||(i.type==='email'&&i.value&&!/^\S+@\S+\.\S+$/.test(i.value));i.setAttribute('aria-invalid',bad?'true':'false');if(bad)ok=false;});
if(!ok){msg.textContent='Revisá los datos marcados en rojo.';return;}
msg.textContent='Vista previa: acá te llevaría a Mercado Pago para pagar. Todavía no está conectado, no se cobra nada.';};}
pinta();
})();
