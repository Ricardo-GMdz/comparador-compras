// Renderizado en consola del resultado de comparación.
// Produce strings (no imprime) para facilitar el testeo y mantener
// la separación entre lógica de presentación y efectos de I/O.

import type { ComparisonResult, Offer } from "../domain/types.js";

// Separador de columnas y relleno usados al construir la tabla.
const COLUMN_SEPARATOR = "  ";
const HEADER_UNDERLINE_CHAR = "-";

// Encabezados de la tabla de ofertas.
const TABLE_HEADERS = ["#", "Producto", "Proveedor", "Precio", "Confiable"] as const;

/** Marca textual para indicar si un proveedor es confiable. */
const TRUSTED_LABEL = "sí";
const UNTRUSTED_LABEL = "no";

/** Formatea el precio de una oferta como "<monto> <moneda>". */
function formatPrice(offer: Offer): string {
  return `${offer.priceAmount} ${offer.currency}`;
}

/** Construye la fila de texto correspondiente a una oferta. */
function buildRow(offer: Offer, index: number): readonly string[] {
  return [
    String(index + 1),
    offer.productTitle,
    offer.provider.name,
    formatPrice(offer),
    offer.provider.trusted ? TRUSTED_LABEL : UNTRUSTED_LABEL,
  ];
}

/** Calcula el ancho máximo de cada columna a partir de encabezados y filas. */
function computeColumnWidths(rows: readonly (readonly string[])[]): readonly number[] {
  // Arrancamos con el ancho de los encabezados y lo expandimos por cada fila.
  return TABLE_HEADERS.map((header, columnIndex) => {
    const cellWidths = rows.map((row) => row[columnIndex].length);
    return Math.max(header.length, ...cellWidths);
  });
}

/** Rellena una celda con espacios a la derecha hasta el ancho indicado. */
function padCell(value: string, width: number): string {
  return value.padEnd(width, " ");
}

/** Une las celdas de una fila aplicando el ancho de cada columna. */
function joinRow(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((cell, index) => padCell(cell, widths[index])).join(COLUMN_SEPARATOR);
}

/** Renderiza la tabla de ofertas como un único string multilínea. */
function renderOffersTable(offers: readonly Offer[]): string {
  const rows = offers.map((offer, index) => buildRow(offer, index));
  const widths = computeColumnWidths(rows);

  const headerLine = joinRow(TABLE_HEADERS, widths);
  const underline = joinRow(
    TABLE_HEADERS.map((_, index) => HEADER_UNDERLINE_CHAR.repeat(widths[index])),
    widths,
  );
  const bodyLines = rows.map((row) => joinRow(row, widths));

  return [headerLine, underline, ...bodyLines].join("\n");
}

/** Construye la línea de recomendación de la mejor oferta, si existe. */
function renderBest(result: ComparisonResult): string | undefined {
  if (!result.best) {
    return undefined;
  }

  return `Mejor opción: ${result.best.productTitle} — ${formatPrice(result.best)} (${result.best.provider.name})`;
}

/** Construye la línea de sugerencia de upgrade, si existe. */
function renderUpgrade(result: ComparisonResult): string | undefined {
  if (!result.upgradeSuggestion) {
    return undefined;
  }

  const upgrade = result.upgradeSuggestion;
  return `Upgrade sugerido: ${upgrade.productTitle} — ${formatPrice(upgrade)} (${upgrade.provider.name})`;
}

/**
 * Renderiza el resultado completo de la comparación como texto listo para
 * imprimir. Devuelve un string; no produce efectos de I/O por sí mismo.
 */
export function renderComparison(result: ComparisonResult): string {
  const header = `Comparación para "${result.product.query}" (región: ${result.product.region})`;

  // Caso sin ofertas: informamos explícitamente en vez de mostrar tabla vacía.
  if (result.offers.length === 0) {
    return [header, "No se encontraron ofertas."].join("\n");
  }

  // Acumulamos solo las secciones que aplican (evita líneas vacías sueltas).
  const sections = [
    header,
    "",
    renderOffersTable(result.offers),
    "",
    renderBest(result),
    renderUpgrade(result),
    result.notes ? `Notas: ${result.notes}` : undefined,
  ].filter((section): section is string => section !== undefined);

  return sections.join("\n");
}
