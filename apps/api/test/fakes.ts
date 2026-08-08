import type { Db } from "../src/db/index.js";

export function fakeDb(overrides: Partial<Db> = {}): Db {
  return {
    ping: async () => {},
    getLink: async () => null,
    findIdempotencyKey: async () => null,
    createLinkWithJob: async () => {
      throw new Error("not implemented in fake");
    },
    ...overrides,
  };
}
