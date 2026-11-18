import pg from "pg";

export function createDatabase(connectionString) {
  return new pg.Pool({ connectionString, max: 1 });
}
