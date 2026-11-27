import { describe, expect, it } from "vitest";
import { formatAccessCode, passwordError, usernameError, usernameToEmail } from "./accounts";
import { daysUntil, formatMoney } from "./format";

describe("códigos de acceso", () => {
  it("formatea lo que escribe el cliente", () => {
    expect(formatAccessCode("e360grmubshgy5h5a2mh")).toBe("E360-GRMU-BSHG-Y5H5-A2MH");
    expect(formatAccessCode("E360-GRMU BSHG-y5h5-A2MH-EXTRA")).toBe("E360-GRMU-BSHG-Y5H5-A2MH");
    expect(formatAccessCode("")).toBe("");
  });
});

describe("usuario y contraseña", () => {
  it("valida nombres de usuario", () => {
    expect(usernameError("ana_perez")).toBeNull();
    expect(usernameError("Ana.Perez")).toBeNull(); // se normaliza a minúsculas
    expect(usernameError("ab")).not.toBeNull();
    expect(usernameError("_ana")).not.toBeNull();
    expect(usernameError("ana perez")).not.toBeNull();
  });
  it("genera el identificador interno sin correo real", () => {
    expect(usernameToEmail(" Ana.Perez ")).toBe("ana.perez@cuentas.eventos360.invalid");
  });
  it("exige contraseñas razonables", () => {
    expect(passwordError("corta1")).not.toBeNull();
    expect(passwordError("soloLetras")).not.toBeNull();
    expect(passwordError("Fiesta2026")).toBeNull();
  });
});

describe("formatos regionales", () => {
  it("formatea córdobas y dólares", () => {
    expect(formatMoney(1250.5, "NIO")).toContain("1");
    expect(formatMoney(1250.5, "NIO")).toMatch(/C\$|NIO/);
    expect(formatMoney(19.99, "USD")).toMatch(/19[.,]99/);
    expect(formatMoney(19.99, "USD")).toContain("US$");
    expect(formatMoney(-5, "USD")).toContain("US$");
  });
  it("calcula días restantes", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(daysUntil("2026-01-08T12:00:00Z", now)).toBe(7);
    expect(daysUntil("2025-12-31T12:00:00Z", now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
  });
});
