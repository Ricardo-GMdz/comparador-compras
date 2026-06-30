// Constantes del módulo de comparación. Evitan números mágicos dispersos
// y centralizan los umbrales de negocio para que sean fáciles de ajustar.

/** Cantidad de decimales a la que se redondea el monto de un precio. */
export const PRICE_DECIMALS = 2;

/** Factor de redondeo derivado de PRICE_DECIMALS (10^decimales). */
export const PRICE_ROUNDING_FACTOR = 10 ** PRICE_DECIMALS;

/**
 * Tope superior del "rango competitivo" para sugerir un upgrade.
 * Una versión superior (mayor `tierRank`) se sugiere si cuesta hasta este
 * múltiplo del precio de la mejor opción (ej. 1.6 = hasta 60% más cara).
 * Como la mejora la garantiza el `tierRank` (no el precio), el tope puede ser
 * más amplio sin riesgo de sugerir una oferta que no sea realmente superior.
 */
export const UPGRADE_MAX_PRICE_RATIO = 1.6;
