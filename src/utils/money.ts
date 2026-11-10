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
 * Перед этим убираем погрешность float: 1147.62 * 100 = 114761.99999999999, а не 114762.
 */
export function toKop(rub: number): number {
  return Math.floor(Math.round(rub * 100 * 1e6) / 1e6);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
