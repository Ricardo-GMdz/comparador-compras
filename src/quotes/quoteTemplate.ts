// Template local para pedidos de cotización a proveedores.
// Función pura: arma un mensaje en español listo para copiar o enviar por WhatsApp.

/** Datos necesarios para armar el mensaje de cotización. */
export interface QuoteMessageInput {
  supplierName: string;
  material: string;
  quantity: string;
  spec: string;
}

/** Construye el mensaje de pedido de cotización en español. */
export function buildQuoteMessage(input: QuoteMessageInput): string {
  return [
    `Hola, buen día. Me comunico con ${input.supplierName}.`,
    "",
    `Estoy buscando: ${input.spec} — cantidad: ${input.quantity}.`,
    "",
    "¿Me podrían compartir su mejor precio de mayoreo, el mínimo de compra y los tiempos de entrega?",
    "",
    "Quedo atento. ¡Gracias!",
  ].join("\n");
}
