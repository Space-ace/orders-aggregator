import { describe, expect, it } from "vitest";
import { dateAtOffset, dateInTimeZone, datesBetween, isCalendarDate, parseUtc, tzOffsetMinutes } from "../src/utils/time.js";

describe("parseUtc", () => {
  it("строка с Z", () => {
    expect(parseUtc("2026-03-01T00:40:39.000Z").toISOString()).toBe("2026-03-01T00:40:39.000Z");
  });

  it("строка без зоны — тоже UTC", () => {
    expect(parseUtc("2026-03-01T00:40:39").toISOString()).toBe("2026-03-01T00:40:39.000Z");
  });

  it("мусор — ошибка", () => {
    expect(() => parseUtc("вчера")).toThrow();
    expect(() => parseUtc(42)).toThrow();
  });
});

describe("tzOffsetMinutes", () => {
  it("считает смещение таймзоны", () => {
    const at = new Date("2026-02-10T12:00:00Z");
    expect(tzOffsetMinutes("UTC", at)).toBe(0);
    expect(tzOffsetMinutes("Europe/Moscow", at)).toBe(180);
    expect(tzOffsetMinutes("Asia/Novosibirsk", at)).toBe(420);
    expect(tzOffsetMinutes("America/New_York", at)).toBe(-300);
  });
});

describe("даты", () => {
  it("dateAtOffset", () => {
    expect(dateAtOffset(new Date("2026-02-10T21:30:00Z"), 180)).toBe("2026-02-11");
    expect(dateAtOffset(new Date("2026-02-10T20:30:00Z"), 180)).toBe("2026-02-10");
  });

  it("dateInTimeZone берёт смещение на сам момент, с учётом летнего времени", () => {
    // Europe/Berlin: 29.03.2026 01:00Z +1 → +2, 25.10.2026 01:00Z +2 → +1
    expect(dateInTimeZone(new Date("2026-03-28T22:40:00Z"), "Europe/Berlin")).toBe("2026-03-28");
    expect(dateInTimeZone(new Date("2026-03-29T22:40:00Z"), "Europe/Berlin")).toBe("2026-03-30");
    expect(dateInTimeZone(new Date("2026-10-24T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-25");
    expect(dateInTimeZone(new Date("2026-10-25T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-25");
  });

  it("isCalendarDate", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("26-02-01")).toBe(false);
  });

  it("datesBetween включает границы", () => {
    expect(datesBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});
