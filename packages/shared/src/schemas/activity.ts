// Optional activities per grant (FR-011).
import { z } from 'zod';

export const activityCreate = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(500),
  isActive: z.boolean().optional(),
});

export const activityUpdate = activityCreate.partial();

export type ActivityCreate = z.infer<typeof activityCreate>;
export type ActivityUpdate = z.infer<typeof activityUpdate>;

export interface Activity {
  id: string;
  grantId: string;
  code: string;
  name: string;
  isActive: boolean;
}
