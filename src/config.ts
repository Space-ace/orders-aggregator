function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing env variable ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/orders"),
  ordersApiUrl: required("ORDERS_API_URL", "http://localhost:4000"),
  port: Number(process.env.PORT ?? 3000),
};
