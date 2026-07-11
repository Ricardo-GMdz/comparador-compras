const $ = (id) => document.getElementById(id);

// Estados posibles de un proveedor (espejo del enum del dominio).
const ESTADOS = ["pendiente", "contactado", "cotizó", "descartado"];

// Estado de la vista: directorio completo + mejor opción de la última búsqueda.
let directorio = [];
let mejorOpcion = null;
// Proveedor activo en el modal de cotización y secuencia anti-carreras del fetch.
let proveedorCotizacion = null;
let cotizacionSeq = 0;

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

function renderBest(best) {
  const el = $("best");
  if (!best) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `
    <span class="badge">★ Mejor opción</span>
    <h3>${esc(best.name)}</h3>
    <div class="meta">${esc(best.material)} · ${esc(best.region)} · ${price(best)}${best.moq !== undefined ? " · mín. " + esc(best.moq) : ""}</div>
    <div class="contacts">${contactFor(best)}</div>`;
}

function estadoSelect(s, key) {
  const options = ESTADOS.map(
    (e) => `<option value="${esc(e)}"${s.status === e ? " selected" : ""}>${esc(e)}</option>`,
  ).join("");
  return `<select class="estado-select" data-key="${esc(key)}">${options}</select>`;
}

function accionesFor(key) {
  return `
    <button type="button" data-action="cotizar" data-key="${esc(key)}">✉️ Cotizar</button>
    <button type="button" data-action="enriquecer" data-key="${esc(key)}">🔍 Completar</button>
    <button type="button" data-action="borrar" data-key="${esc(key)}">🗑</button>`;
}

function renderTable(suppliers) {
  const rows = suppliers
    .map((s) => {
      const key = keyOf(s);
      return `
    <tr class="${s.status === "descartado" ? "row-descartado" : ""}">
      <td><strong>${esc(s.name)}</strong></td>
      <td><span class="tag">${esc(s.material)}</span></td>
      <td>${price(s)}</td>
      <td>${s.moq !== undefined ? esc(s.moq) : "—"}</td>
      <td>${esc(s.region)}</td>
      <td class="contacts">${contactFor(s)}</td>
      <td><span class="chip ${s.trusted ? "chip-green" : "chip-amber"}">${s.trusted ? "Confiable" : "Sin verificar"}</span></td>
      <td>${estadoSelect(s, key)}</td>
      <td class="notas" data-action="notas" data-key="${esc(key)}" title="Click para editar">${s.notes ? esc(s.notes) : "＋ nota"}</td>
      <td class="acciones">${accionesFor(key)}</td>
    </tr>`;
    })
    .join("");
  $("tabla").innerHTML =
    suppliers.length === 0
      ? ""
      : `
    <table><thead><tr>
      <th>Proveedor</th><th>Material</th><th>Mayoreo</th><th>Mín.</th><th>Región</th><th>Contacto</th><th>Confianza</th><th>Estado</th><th>Notas</th><th>Acciones</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// Filtro client-side por texto (nombre/material) y estado.
function filtrados() {
  const texto = $("filtro").value.trim().toLowerCase();
  const estado = $("filtroEstado").value;
  return directorio.filter((s) => {
    const matchTexto =
      texto === "" ||
      s.name.toLowerCase().includes(texto) ||
      s.material.toLowerCase().includes(texto);
    const matchEstado = estado === "todos" || s.status === estado;
    return matchTexto && matchEstado;
  });
}

function render() {
  $("total").textContent = `${directorio.length} en el directorio`;
  renderBest(mejorOpcion);
  renderTable(filtrados());
}

async function cargarDirectorio() {
  const region = $("region").value.trim() || "global";
  try {
    const res = await fetch(`/api/directorio?region=${encodeURIComponent(region)}`);
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo cargar el directorio.";
      return;
    }
    directorio = data.suppliers;
    render();
  } catch {
    $("status").textContent = "No se pudo cargar el directorio.";
  }
}

// --- Mutaciones (PATCH / DELETE / enriquecer) ---

async function patchProveedor(key, patch) {
  try {
    const res = await fetch(`/api/proveedor/${encodeURIComponent(key)}`, {
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
  } catch {
    $("status").textContent = "No se pudo actualizar el proveedor.";
  }
}

async function borrarProveedor(key) {
  try {
    const res = await fetch(`/api/proveedor/${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo borrar el proveedor.";
      return;
    }
    if (mejorOpcion && keyOf(mejorOpcion) === key) mejorOpcion = null;
    $("status").textContent = "Proveedor eliminado.";
    await cargarDirectorio();
  } catch {
    $("status").textContent = "No se pudo borrar el proveedor.";
  }
}

async function enriquecerProveedor(key, boton) {
  boton.disabled = true;
  boton.textContent = "Buscando…";
  try {
    const res = await fetch(`/api/proveedor/${encodeURIComponent(key)}/enriquecer`, {
      method: "POST",
    });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo completar el contacto.";
      return;
    }
    $("status").textContent = "Contacto actualizado.";
    await cargarDirectorio();
  } catch {
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
    const res = await fetch(
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
  } catch {
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

// --- Eventos ---

$("buscar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("query").value.trim();
  const region = $("region").value.trim() || "global";
  if (!query) return;
  $("status").textContent = "Buscando proveedores…";
  try {
    const res = await fetch("/api/buscar", {
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
    render();
    $("status").textContent = `${data.nuevos} nuevos · ${data.total} en total`;
  } catch {
    $("status").textContent = "No se pudo completar la búsqueda.";
  }
});

$("filtro").addEventListener("input", render);
$("filtroEstado").addEventListener("change", render);

// Publicar la selección (contactados/cotizó) al directorio público de la landing.
$("publicar").addEventListener("click", async () => {
  const boton = $("publicar");
  boton.disabled = true;
  try {
    const res = await fetch("/api/publicar", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      $("status").textContent = data.error ?? "No se pudo publicar.";
      return;
    }
    $("status").textContent =
      `${data.publicados} proveedores publicados en landing/proveedores.json — ` +
      "commiteá y pusheá para verlos en la landing.";
  } catch {
    $("status").textContent = "No se pudo publicar.";
  } finally {
    boton.disabled = false;
  }
});

// Delegación: cambios de estado por fila.
$("tabla").addEventListener("change", (e) => {
  const select = e.target.closest(".estado-select");
  if (!select) return;
  patchProveedor(select.dataset.key, { status: select.value });
});

// Delegación: notas y botones de acción por fila.
$("tabla").addEventListener("click", (e) => {
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
  }
});

$("mCantidad").addEventListener("input", generarMensaje);
$("mSpec").addEventListener("input", generarMensaje);
$("mCopiar").addEventListener("click", copiarMensaje);
$("mCerrar").addEventListener("click", cerrarCotizacion);
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) cerrarCotizacion();
});

cargarDirectorio();
