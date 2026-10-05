import { z } from "zod";

const exportCellSchema = z.object({
  v: z.number().finite().nullable(),
  style: z.string().nullable(),
});

const exportRowSchema = z.object({
  name: z.string(),
  depth: z.number().int().min(0).max(64),
  bold: z.boolean(),
  values: z.array(exportCellSchema).max(2000),
});

export const exportPayloadSchema = z.object({
  name: z.string().max(200),
  rowHeader: z.string().max(200),
  headerRows: z.array(z.array(z.string().max(200)).max(2000)).max(20),
  rows: z.array(exportRowSchema).max(20000),
  totals: z.array(exportCellSchema).max(2000),
  decimals: z.number().int().min(0).max(10),
});
