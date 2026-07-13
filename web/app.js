const $ = (id) => document.getElementById(id);

// Estados posibles de un proveedor (espejo del enum del dominio).
const ESTADOS = ["pendiente", "contactado", "cotizó", "descartado"];

// Estado de la vista: directorio completo + mejor opción de la última búsqueda.
let directorio = [];
let mejorOpcion = null;
// Claves de los proveedores hallados en la última búsqueda (null = sin búsqueda aún).
let resultadosKeys = null;
// Proveedor activo en el modal de cotización y secuencia anti-carreras del fetch.
let proveedorCotizacion = null;
let cotizacionSeq = 0;
// Vista activa del sidebar: "inicio" o "historial".
let vistaActual = "inicio";

// Wrapper de fetch a la API: ante 401 muestra la pantalla de clave y corta el flujo.
async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    mostrarLogin();
    throw new Error("no-autorizado");
  }
  return res;
}

function mostrarLogin() {
  $("login").classList.remove("hidden");
  $("loginKey").focus();
}

function ocultarLogin() {
  $("login").classList.add("hidden");
}

// Los datos del proveedor vienen del modelo/web_search (fuente externa no
// confiable): se escapan antes de inyectarlos en innerHTML para evitar XSS.
function esc(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (ch) => map[ch]);
}

// Devuelve la URL solo si es http/https absoluta; si no, null (no se renderiza el
// link). Evita esquemas peligrosos como javascript: en website/formUrl.
function httpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

// Clave de identidad del proveedor (espejo de supplierKey del server): dominio
// del sitio si existe; si no, nombre normalizado + región.
function keyOf(s) {
  if (s.website) {
    try {
      const host = new URL(s.website).hostname.replace(/^www\./, "").toLowerCase();
      return `d:${host}`;
    } catch {
      // Sin dominio válido: cae a la clave por nombre.
    }
  }
  return `n:${s.name.trim().toLowerCase()}|${s.region.trim().toLowerCase()}`;
}

function proveedorPorKey(key) {
  return directorio.find((s) => keyOf(s) === key);
}

function contactLinks(c) {
  const items = [];
  const web = httpUrl(c.website);
  if (web) items.push(`<a href="${esc(web)}" target="_blank" rel="noopener">🌐 Web</a>`);
  if (c.email) items.push(`<a href="mailto:${esc(c.email)}">✉️ Email</a>`);
  if (c.phone) items.push(`<a href="tel:${esc(c.phone)}">📞 Tel</a>`);
  if (c.whatsapp)
    items.push(
      `<a href="https://wa.me/${c.whatsapp.replace(/[^0-9]/g, "")}" target="_blank" rel="noopener">💬 WhatsApp</a>`,
    );
  const form = httpUrl(c.formUrl);
  if (form) items.push(`<a href="${esc(form)}" target="_blank" rel="noopener">📝 Formulario</a>`);
  return items.join("");
}

function contactFor(s) {
  return contactLinks({ website: s.website, ...s.contact });
}

// Precio de mayoreo con moneda y unidad ("/ kg") cuando se conocen.
function price(s) {
  if (s.wholesalePrice === undefined) return "—";
  const currency = s.currency ? " " + esc(s.currency) : "";
  const unit = s.priceUnit && s.priceUnit !== "unknown" ? ` / ${esc(s.priceUnit)}` : "";
  return `$${esc(s.wholesalePrice)}${currency}${unit}`;
}

// Precio de catálogo (lista) con moneda; "—" si no hay.
function catalogPrice(s) {
  if (s.catalogPrice === undefined) return "—";
  const currency = s.currency ? " " + esc(s.currency) : "";
  const unit = s.priceUnit && s.priceUnit !== "unknown" ? ` / ${esc(s.priceUnit)}` : "";
  return `$${esc(s.catalogPrice)}${currency}${unit}`;
}

// Precio numérico efectivo para ordenar: mayoreo si hay, si no catálogo; Infinity si ninguno.
function precioEfectivo(s) {
  if (typeof s.wholesalePrice === "number") return s.wholesalePrice;
  if (typeof s.catalogPrice === "number") return s.catalogPrice;
  return Infinity;
}

// Chip de disponibilidad (stock); vacío cuando es desconocida.
function stockChip(s) {
  if (s.availability === "disponible") return '<span class="chip chip-green">stock</span>';
  if (s.availability === "sobre_pedido") return '<span class="chip chip-amber">sobre pedido</span>';
  return "";
}

function renderBest(best) {
  const el = $("best");
  if (!best) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  // Precio a mostrar: mayoreo si hay; si no, catálogo (marcado); si no, a cotizar.
  const precio =
    price(best) !== "—"
      ? price(best)
      : catalogPrice(best) !== "—"
        ? `${catalogPrice(best)} · catálogo`
        : "Precio a cotizar";
  el.innerHTML = `
    <div class="best-top">
      <span class="badge">Mejor opción</span>
      ${best.trusted ? '<span class="sello">✓ Confiable</span>' : ""}
    </div>
    <h3>${esc(best.name)}</h3>
    <div class="best-precio num">${precio}</div>
    <div class="meta">${esc(best.material)} · ${esc(best.region)}${best.moq !== undefined ? " · mín. " + esc(best.moq) : ""}</div>
    <div class="contacts">${contactFor(best)}</div>`;
}

function estadoSelect(s, key) {
  const options = ESTADOS.map(
    (e) => `<option value="${esc(e)}"${s.status === e ? " selected" : ""}>${esc(e)}</option>`,
  ).join("");
  return `<select class="estado-select" data-key="${esc(key)}">${options}</select>`;
}

function accionesFor(s, key) {
  const star = s.favorite ? "★" : "☆";
  return `
    <button type="button" class="fav ${s.favorite ? "fav-on" : ""}" data-action="favorito" data-key="${esc(key)}" title="Favorito">${star}</button>
    <button type="button" data-action="cotizar" data-key="${esc(key)}" title="Cotizar">✉️ Cotizar</button>
    <button type="button" data-action="enriquecer" data-key="${esc(key)}" title="Completar datos">🔍 Completar</button>
    <button type="button" data-action="borrar" data-key="${esc(key)}" title="Borrar">🗑</button>`;
}

function renderTable(suppliers, targetId = "tabla") {
  const rows = suppliers
    .map((s) => {
      const key = keyOf(s);
      return `
    <tr class="${s.status === "descartado" ? "row-descartado" : ""}">
      <td><a href="#" class="nombre-link" data-action="detalle" data-key="${esc(key)}">${esc(s.name)}</a></td>
      <td><span class="tag">${esc(s.material)}</span></td>
      <td>${price(s)} ${stockChip(s)}</td>
      <td>${s.moq !== undefined ? esc(s.moq) : "—"}</td>
      <td>${esc(s.region)}</td>
      <td class="contacts">${contactFor(s)}</td>
      <td><span class="chip ${s.trusted ? "chip-green" : "chip-amber"}">${s.trusted ? "Confiable" : "Sin verificar"}</span></td>
      <td>${estadoSelect(s, key)}</td>
      <td class="notas" data-action="notas" data-key="${esc(key)}" title="${s.notes ? esc(s.notes) : "Click para editar"}">${s.notes ? `<span class="notas-txt">${esc(s.notes)}</span>` : "＋ nota"}</td>
      <td class="acciones">${accionesFor(s, key)}</td>
    </tr>`;
    })
    .join("");
  $(targetId).innerHTML =
    suppliers.length === 0
      ? ""
      : `
    <table>
      <colgroup>
        <col style="width:14%" /><col style="width:14%" /><col style="width:6%" /><col style="width:5%" /><col style="width:5%" /><col style="width:8%" /><col style="width:9%" /><col style="width:9%" /><col style="width:12%" /><col style="width:18%" />
      </colgroup>
      <thead><tr>
      <th>Proveedor</th><th>Material</th><th>Mayoreo</th><th>Mín.</th><th>Región</th><th>Contacto</th><th>Confianza</th><th>Estado</th><th>Notas</th><th>Acciones</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// Filtro client-side por texto, estado y favoritos; luego ordena.
function filtrados() {
  const texto = $("filtro").value.trim().toLowerCase();
  const estado = $("filtroEstado").value;
  const soloFav = $("soloFav").checked;
  const orden = $("orden").value;
  const lista = directorio.filter((s) => {
    const matchTexto =
      texto === "" ||
      s.name.toLowerCase().includes(texto) ||
      s.material.toLowerCase().includes(texto);
    const matchEstado = estado === "todos" || s.status === estado;
    const matchFav = !soloFav || s.favorite === true;
    return matchTexto && matchEstado && matchFav;
  });
  const ordenada = [...lista];
  if (orden === "precio") {
    ordenada.sort((a, b) => precioEfectivo(a) - precioEfectivo(b));
  } else if (orden === "favoritos") {
    ordenada.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  } else if (orden === "nombre") {
    ordenada.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    ordenada.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  }
  return ordenada;
}

// Pinta la sección de favoritos de Inicio (reusa la tabla; mensaje si no hay).
function renderFavoritos() {
  const favs = directorio.filter((s) => s.favorite === true);
  if (favs.length === 0) {
    $("favoritos").innerHTML = '<p class="vacio">Todavía no marcaste favoritos.</p>';
    return;
  }
  renderTable(favs, "favoritos");
}

// Muestra en Inicio los proveedores de la última búsqueda (frescos desde el directorio).
function renderResultados() {
  if (!resultadosKeys) {
    $("resultados-wrap").classList.add("hidden");
    $("resultados").innerHTML = "";
    return;
  }
  const items = directorio.filter((s) => resultadosKeys.has(keyOf(s)));
  if (items.length === 0) {
    $("resultados-wrap").classList.add("hidden");
    $("resultados").innerHTML = "";
    return;
  }
  $("resultados-wrap").classList.remove("hidden");
  renderTable(items, "resultados");
}

function render() {
  $("total").textContent = `${directorio.length} en el directorio`;
  renderBest(mejorOpcion);
  renderResultados();
  renderFavoritos();
  renderTable(filtrados());
}

// Cambia entre las vistas del sidebar (Inicio / Historial) sin recargar.
function mostrarVista(vista) {
  if (vista === vistaActual) return;
  vistaActual = vista;
  $("vista-inicio").classList.toggle("hidden", vista !== "inicio");
  $("vista-historial").classList.toggle("hidden", vista !== "historial");
  document.querySelectorAll(".nav-item").forEach((boton) => {
    boton.classList.toggle("active", boton.dataset.vista === vista);
  });
  render();
}

async function cargarDirectorio() {
  const region = $("region").value.trim() || "global";
  try {
    const res = await apiFetch(`/api/directorio?region=${encodeURIComponent(region)}`);
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo cargar el directorio.";
      return;
    }
    directorio = data.suppliers;
    render();
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo cargar el directorio.";
  }
}

// --- Mutaciones (PATCH / DELETE / enriquecer) ---

async function patchProveedor(key, patch) {
  try {
    const res = await apiFetch(`/api/proveedor/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo actualizar el proveedor.";
      return;
    }
    $("status").textContent = "Guardado.";
    await cargarDirectorio();
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo actualizar el proveedor.";
  }
}

async function borrarProveedor(key) {
  try {
    const res = await apiFetch(`/api/proveedor/${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo borrar el proveedor.";
      return;
    }
    if (mejorOpcion && keyOf(mejorOpcion) === key) mejorOpcion = null;
    $("status").textContent = "Proveedor eliminado.";
    await cargarDirectorio();
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo borrar el proveedor.";
  }
}

async function enriquecerProveedor(key, boton) {
  boton.disabled = true;
  boton.textContent = "Buscando…";
  try {
    const res = await apiFetch(`/api/proveedor/${encodeURIComponent(key)}/enriquecer`, {
      method: "POST",
    });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo completar el contacto.";
      return;
    }
    $("status").textContent = "Contacto actualizado.";
    await cargarDirectorio();
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo completar el contacto.";
  } finally {
    // Si la tabla no se re-renderizó (error), se rehabilita el botón original.
    boton.disabled = false;
    boton.textContent = "🔍 Completar";
  }
}

// --- Modal de cotización ---

function abrirCotizacion(supplier) {
  proveedorCotizacion = supplier;
  $("modalTitulo").textContent = `Cotización — ${supplier.name}`;
  $("mCantidad").value = "";
  $("mSpec").value = supplier.material;
  $("mMensaje").value = "";
  $("modal").classList.remove("hidden");
  generarMensaje();
  $("mCantidad").focus();
}

function cerrarCotizacion() {
  proveedorCotizacion = null;
  $("modal").classList.add("hidden");
}

function actualizarWhatsapp(mensaje) {
  const wa = $("mWhatsapp");
  const numero = proveedorCotizacion?.contact?.whatsapp;
  if (!numero || !mensaje) {
    wa.classList.add("hidden");
    wa.removeAttribute("href");
    return;
  }
  const digits = numero.replace(/[^0-9]/g, "");
  wa.href = `https://wa.me/${digits}?text=${encodeURIComponent(mensaje)}`;
  wa.classList.remove("hidden");
}

// Pide el mensaje al server (única fuente del template). Descarta respuestas
// viejas si el usuario siguió tipeando (secuencia).
async function generarMensaje() {
  if (!proveedorCotizacion) return;
  const quantity = $("mCantidad").value.trim();
  const spec = $("mSpec").value.trim();
  if (!quantity || !spec) {
    $("mMensaje").value = "Completá cantidad y especificación para generar el mensaje.";
    actualizarWhatsapp("");
    return;
  }
  const seq = ++cotizacionSeq;
  const key = keyOf(proveedorCotizacion);
  try {
    const res = await apiFetch(
      `/api/proveedor/${encodeURIComponent(key)}/cotizacion?quantity=${encodeURIComponent(quantity)}&spec=${encodeURIComponent(spec)}`,
    );
    const data = await res.json();
    if (seq !== cotizacionSeq || !proveedorCotizacion) return;
    if (!data.ok) {
      $("mMensaje").value = data.error ?? "No se pudo generar el mensaje.";
      actualizarWhatsapp("");
      return;
    }
    $("mMensaje").value = data.message;
    actualizarWhatsapp(data.message);
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    if (seq !== cotizacionSeq) return;
    $("mMensaje").value = "No se pudo generar el mensaje.";
    actualizarWhatsapp("");
  }
}

async function copiarMensaje() {
  const mensaje = $("mMensaje").value;
  if (!mensaje) return;
  const boton = $("mCopiar");
  try {
    await navigator.clipboard.writeText(mensaje);
    boton.textContent = "Copiado ✓";
  } catch {
    boton.textContent = "No se pudo copiar";
  }
  setTimeout(() => {
    boton.textContent = "Copiar mensaje";
  }, 1500);
}

// --- Modal de detalle ---

function fila(label, valor) {
  if (valor === undefined || valor === "" || valor === "—") return "";
  return `<div class="d-fila"><span class="d-label">${esc(label)}</span><span class="d-val">${valor}</span></div>`;
}

function abrirDetalle(s) {
  $("dTitulo").textContent = s.name;
  const stock =
    s.availability === "disponible"
      ? "En stock"
      : s.availability === "sobre_pedido"
        ? "Sobre pedido"
        : "—";
  $("dCuerpo").innerHTML = [
    fila("Material", esc(s.material)),
    fila("Mayoreo", price(s)),
    fila("Catálogo", catalogPrice(s)),
    fila("Mínimo de compra", s.moq !== undefined ? esc(s.moq) : "—"),
    fila("Stock", stock),
    fila("Dirección", s.address ? esc(s.address) : "—"),
    fila("Región", esc(s.region)),
    fila("Confianza", s.trusted ? "Confiable" : "Sin verificar"),
    fila("Estado", esc(s.status)),
    fila("Contacto", contactFor(s) || "—"),
    fila("Notas", s.notes ? esc(s.notes) : "—"),
    fila("Envío", "Se consulta en la cotización"),
  ].join("");
  $("detalle").classList.remove("hidden");
}

function cerrarDetalle() {
  $("detalle").classList.add("hidden");
}

// --- Eventos ---

$("buscar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("query").value.trim();
  const region = $("region").value.trim() || "global";
  if (!query) return;
  $("status").textContent = "Buscando proveedores…";
  try {
    const res = await apiFetch("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, region }),
    });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "Error en la búsqueda.";
      return;
    }
    directorio = data.suppliers;
    mejorOpcion = data.mejorOpcion;
    resultadosKeys = new Set((data.encontrados ?? []).map(keyOf));
    render();
    $("status").textContent = `${data.nuevos} nuevos · ${data.total} en total`;
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo completar la búsqueda.";
  }
});

$("filtro").addEventListener("input", render);
$("filtroEstado").addEventListener("change", render);
$("orden").addEventListener("change", render);
$("soloFav").addEventListener("change", render);

document.querySelectorAll(".nav-item").forEach((boton) => {
  boton.addEventListener("click", () => mostrarVista(boton.dataset.vista));
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("loginKey").value;
  $("loginError").textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      $("loginError").textContent = "Clave incorrecta.";
      return;
    }
    ocultarLogin();
    $("loginKey").value = "";
    await cargarDirectorio();
  } catch {
    $("loginError").textContent = "No se pudo verificar la clave.";
  }
});

// Publicar la selección (contactados/cotizó) al directorio público de la landing.
$("publicar").addEventListener("click", async () => {
  const boton = $("publicar");
  boton.disabled = true;
  try {
    const res = await apiFetch("/api/publicar", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo publicar.";
      return;
    }
    $("status").textContent =
      `${data.publicados} proveedores publicados — ya visibles en la landing.`;
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo publicar.";
  } finally {
    boton.disabled = false;
  }
});

// Handlers de fila (se usan tanto en la tabla del Historial como en favoritos).
function onFilaChange(e) {
  const select = e.target.closest(".estado-select");
  if (!select) return;
  patchProveedor(select.dataset.key, { status: select.value });
}

function onFilaClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const key = el.dataset.key;
  const supplier = proveedorPorKey(key);
  if (!supplier) return;
  if (el.dataset.action === "notas") {
    const nuevas = prompt("Notas del proveedor:", supplier.notes ?? "");
    if (nuevas !== null) patchProveedor(key, { notes: nuevas });
  } else if (el.dataset.action === "cotizar") {
    abrirCotizacion(supplier);
  } else if (el.dataset.action === "enriquecer") {
    enriquecerProveedor(key, el);
  } else if (el.dataset.action === "borrar") {
    if (confirm(`¿Borrar a "${supplier.name}" del directorio?`)) borrarProveedor(key);
  } else if (el.dataset.action === "favorito") {
    e.preventDefault();
    patchProveedor(key, { favorite: !supplier.favorite });
  } else if (el.dataset.action === "detalle") {
    e.preventDefault();
    abrirDetalle(supplier);
  }
}

$("tabla").addEventListener("change", onFilaChange);
$("tabla").addEventListener("click", onFilaClick);
$("resultados").addEventListener("change", onFilaChange);
$("resultados").addEventListener("click", onFilaClick);
$("favoritos").addEventListener("change", onFilaChange);
$("favoritos").addEventListener("click", onFilaClick);

$("mCantidad").addEventListener("input", generarMensaje);
$("mSpec").addEventListener("input", generarMensaje);
$("mCopiar").addEventListener("click", copiarMensaje);
$("mCerrar").addEventListener("click", cerrarCotizacion);
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) cerrarCotizacion();
});

$("dCerrar").addEventListener("click", cerrarDetalle);
$("detalle").addEventListener("click", (e) => {
  if (e.target === $("detalle")) cerrarDetalle();
});

cargarDirectorio();
