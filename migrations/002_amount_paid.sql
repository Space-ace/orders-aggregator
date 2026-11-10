-- Фактически оплаченная сумма (со скидкой). У заказов в старом формате, без полей скидки, она равна сумме заказа.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
UPDATE orders SET amount_paid_kop = amount_kop;
ALTER TABLE orders ALTER COLUMN amount_paid_kop SET NOT NULL;
