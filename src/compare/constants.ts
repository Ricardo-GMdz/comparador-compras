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

/**
 * Fracción de la mediana por debajo de la cual un precio se considera outlier
 * (sospechosamente bajo: posible error de parseo o promo engañosa). Ej. 0.4 =
 * una oferta a menos del 40% de la mediana de las comparables se marca como
 * sospechosa y no se elige como mejor opción.
 */
export const PRICE_OUTLIER_MIN_RATIO = 0.4;

/**
 * Cantidad mínima de ofertas comparables necesaria para activar la detección de
 * outliers. Con muy pocas ofertas la mediana no representa un consenso: con 2,
 * la más barata queda siempre por debajo de la mediana (el punto medio), así que
 * una simple dispersión normal (la cara > 4x la barata) marcaría a la barata
 * legítima como outlier. Por debajo de este umbral, ninguna oferta se trata como
 * outlier (se necesita una muestra con consenso contra la cual medir la anomalía).
 */
export const PRICE_OUTLIER_MIN_SAMPLE = 4;
