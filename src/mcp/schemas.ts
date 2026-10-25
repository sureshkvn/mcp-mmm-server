import { z } from 'zod';

/** Views are projections of a work order; extra fields (notes, history...) pass through. */
export const WorkOrderViewSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    assetId: z.string(),
    priority: z.string(),
    state: z.string(),
    dueAt: z.string().optional(),
  })
  .catchall(z.unknown());

export const LooseRecord = z.record(z.string(), z.unknown());

export const DisclosureDeltaSchema = z.object({
  toolsAdded: z.array(z.string()),
  toolsRemoved: z.array(z.string()),
  promptsAdded: z.array(z.string()),
  promptsRemoved: z.array(z.string()),
});
