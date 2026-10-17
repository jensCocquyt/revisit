import { z } from "zod";
import type { ErrorResponse } from "../../contract.js";

export const itemIdParams = z.object({ id: z.uuid() });

export const itemNotFound: ErrorResponse = { error: "item not found" };
