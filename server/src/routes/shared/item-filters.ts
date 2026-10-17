import { z } from "zod";

const isoDate = z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional();

export const itemFilterQuery = {
  kind: z.enum(["text", "link", "screenshot"]).optional(),
  from: isoDate,
  to: isoDate,
};
