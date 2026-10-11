import { z } from 'zod';

export const alertSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);

export const systemAlertSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: alertSeveritySchema,
  message: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  occurrences: z.number(),
  acknowledgedAt: z.string().nullable(),
});
export type SystemAlertDto = z.infer<typeof systemAlertSchema>;

export const systemHealthSchema = z.object({
  worker: z.object({
    status: z.enum(['ok', 'down', 'unknown']),
    lastBeatAt: z.string().nullable(),
    ageSeconds: z.number().nullable(),
  }),
  queues: z.array(
    z.object({
      name: z.string(),
      waiting: z.number(),
      active: z.number(),
      delayed: z.number(),
      failed: z.number(),
    }),
  ),
  alerts: z.array(systemAlertSchema),
});
export type SystemHealth = z.infer<typeof systemHealthSchema>;

export const alertIdParams = z.object({ alertId: z.uuid() });
