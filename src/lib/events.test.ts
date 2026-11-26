import { describe, expect, it } from "vitest";
import { fromLocalInput, guestSeats, toLocalInput } from "./events";

describe("fechas en la zona horaria del espacio", () => {
  it("Managua (UTC-6): 19:00 local = 01:00 UTC del día siguiente", () => {
    expect(fromLocalInput("2026-12-20T19:00", "America/Managua")).toBe("2026-12-21T01:00:00.000Z");
    expect(toLocalInput("2026-12-21T01:00:00.000Z", "America/Managua")).toBe("2026-12-20T19:00");
  });
  it("ida y vuelta con horario de verano (Nueva York, julio UTC-4)", () => {
    const iso = fromLocalInput("2026-07-04T18:30", "America/New_York");
    expect(iso).toBe("2026-07-04T22:30:00.000Z");
    expect(toLocalInput(iso, "America/New_York")).toBe("2026-07-04T18:30");
  });
  it("vacío", () => {
    expect(fromLocalInput("", "America/Managua")).toBeNull();
    expect(toLocalInput(null, "America/Managua")).toBe("");
  });
});

describe("lugares por invitado", () => {
  it("confirmado usa personas reales; declinado no ocupa", () => {
    expect(guestSeats({ status: "confirmed", adults: 2, children: 1, max_companions: 4 })).toBe(3);
    expect(guestSeats({ status: "declined", adults: 1, children: 0, max_companions: 4 })).toBe(0);
    expect(guestSeats({ status: "pending", adults: 1, children: 0, max_companions: 4 })).toBe(5);
  });
});
