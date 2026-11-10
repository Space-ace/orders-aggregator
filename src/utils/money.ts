/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 * Но целые копейки из-за погрешности float могут выйти чуть меньше целого: 1147.62 * 100 = 114761.99999999999.
 * Погрешность умножения не больше Number.EPSILON от величины: что ближе к целому — это целые копейки,
 * остальное — настоящие доли копейки, их отбрасываем.
 */
export function toKop(rub: number): number {
  const kop = rub * 100;
  const nearest = Math.round(kop);
  return Math.abs(kop - nearest) <= Number.EPSILON * Math.max(1, Math.abs(kop)) ? nearest : Math.floor(kop);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
