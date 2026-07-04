const $ = (id) => document.getElementById(id);

function contactLinks(c) {
  const items = [];
  if (c.website) items.push(`<a href="${c.website}" target="_blank">🌐 Web</a>`);
  if (c.email) items.push(`<a href="mailto:${c.email}">✉️ Email</a>`);
  if (c.phone) items.push(`<a href="tel:${c.phone}">📞 Tel</a>`);
  if (c.whatsapp)
    items.push(
      `<a href="https://wa.me/${c.whatsapp.replace(/[^0-9]/g, "")}" target="_blank">💬 WhatsApp</a>`,
    );
  if (c.formUrl) items.push(`<a href="${c.formUrl}" target="_blank">📝 Formulario</a>`);
  return items.join("");
}

function contactFor(s) {
  return contactLinks({ website: s.website, ...s.contact });
}

function price(s) {
  return s.wholesalePrice !== undefined
    ? `$${s.wholesalePrice}${s.currency ? " " + s.currency : ""}`
    : "—";
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
    <h3>${best.name}</h3>
    <div class="meta">${best.material} · ${best.region} · ${price(best)}${best.moq ? " · mín. " + best.moq : ""}</div>
    <div class="contacts">${contactFor(best)}</div>`;
}

function renderTable(suppliers) {
  const rows = suppliers
    .map(
      (s) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td><span class="tag">${s.material}</span></td>
      <td>${price(s)}</td>
      <td>${s.moq ?? "—"}</td>
      <td>${s.region}</td>
      <td class="contacts">${contactFor(s)}</td>
      <td><span class="chip ${s.trusted ? "chip-green" : "chip-amber"}">${s.trusted ? "Confiable" : "Sin verificar"}</span></td>
    </tr>`,
    )
    .join("");
  $("tabla").innerHTML =
    suppliers.length === 0
      ? ""
      : `
    <table><thead><tr>
      <th>Proveedor</th><th>Material</th><th>Mayoreo</th><th>Mín.</th><th>Región</th><th>Contacto</th><th>Estado</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function render(data) {
  $("total").textContent = `${data.suppliers.length} en el directorio`;
  renderBest(data.mejorOpcion);
  renderTable(data.suppliers);
}

async function cargarDirectorio() {
  const region = $("region").value.trim() || "global";
  const res = await fetch(`/api/directorio?region=${encodeURIComponent(region)}`);
  const data = await res.json();
  render({ suppliers: data.suppliers, mejorOpcion: null });
}

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
    render(data);
    $("status").textContent = `${data.nuevos} nuevos · ${data.total} en total`;
  } catch {
    $("status").textContent = "No se pudo completar la búsqueda.";
  }
});

cargarDirectorio();
