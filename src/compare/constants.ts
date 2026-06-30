// Constantes del módulo de comparación. Evitan números mágicos dispersos
// y centralizan los umbrales de negocio para que sean fáciles de ajustar.

/** Cantidad de decimales a la que se redondea el monto de un precio. */
export const PRICE_DECIMALS = 2;

/** Factor de redondeo derivado de PRICE_DECIMALS (10^decimales). */
export const PRICE_ROUNDING_FACTOR = 10 ** PRICE_DECIMALS;

/**
 * Tope superior del "rango similar" para sugerir un upgrade.
 * Una oferta se considera upgrade si cuesta hasta este múltiplo del precio
 * de la mejor opción (ej. 1.25 = hasta 25% más cara).
 */
export const UPGRADE_MAX_PRICE_RATIO = 1.25;

/**
 * Piso inferior del "rango similar" para sugerir un upgrade.
 * Evita proponer como upgrade algo prácticamente al mismo precio que la mejor.
 */
export const UPGRADE_MIN_PRICE_RATIO = 1.0;
