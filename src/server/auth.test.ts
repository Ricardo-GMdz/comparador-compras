import { describe, it, expect } from "vitest";
import { hashEqual, makeToken, verifyToken } from "./auth.js";

const SECRET = "clave-super-secreta";
const NOW = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("auth", () => {
  it("hashEqual: true para iguales, false para distintos", () => {
    expect(hashEqual("abc", "abc")).toBe(true);
    expect(hashEqual("abc", "abd")).toBe(false);
    expect(hashEqual("corta", "muchisimo-mas-larga")).toBe(false);
  });

  it("verifyToken acepta un token recién emitido y no vencido", () => {
    const token = makeToken(NOW + 30 * DAY, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBe(true);
  });

  it("verifyToken rechaza token vencido", () => {
    const token = makeToken(NOW - 1, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBe(false);
  });

  it("verifyToken rechaza firma con secreto distinto", () => {
    const token = makeToken(NOW + DAY, SECRET);
    expect(verifyToken(token, "otro-secreto", NOW)).toBe(false);
  });

  it("verifyToken rechaza token adulterado o ausente", () => {
    expect(verifyToken(undefined, SECRET, NOW)).toBe(false);
    expect(verifyToken("", SECRET, NOW)).toBe(false);
    expect(verifyToken("basura-sin-punto", SECRET, NOW)).toBe(false);
    const token = makeToken(NOW + DAY, SECRET);
    expect(verifyToken(token + "x", SECRET, NOW)).toBe(false);
    expect(verifyToken("NaN.firma", SECRET, NOW)).toBe(false);
    expect(verifyToken("-100.firma", SECRET, NOW)).toBe(false);
    expect(verifyToken(".firma", SECRET, NOW)).toBe(false);
    // Firma vacía (token "exp.") también se rechaza.
    expect(verifyToken(`${NOW + DAY}.`, SECRET, NOW)).toBe(false);
    // Token canónico válido no se rompe con el parseo estricto.
    const canon = makeToken(NOW + DAY, SECRET);
    expect(verifyToken(canon, SECRET, NOW)).toBe(true);
    // Variantes no canónicas del mismo exp NO validan aunque reusen la firma.
    const dot = canon.indexOf(".");
    const sig = canon.slice(dot + 1);
    expect(verifyToken(`+${NOW + DAY}.${sig}`, SECRET, NOW)).toBe(false);
    expect(verifyToken(` ${NOW + DAY}.${sig}`, SECRET, NOW)).toBe(false);
  });
});
