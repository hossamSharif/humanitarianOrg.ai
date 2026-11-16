// PR list and "My tasks" (contracts/rest-api.md `GET /prs`, `GET /prs/my-tasks`; FR-046,
// FR-047). Filters arrive as query strings; `status` may repeat (`?status=a&status=b`) or use
// the bracket form (`status[]=a`). The amount range is in the grant currency and therefore
// matches only submitted PRs (drafts have no locked grant-currency total yet).
import { z } from 'zod';
import type { Money } from '../money';
import { PR_STATUSES, type PrStatus } from '../pr-state';
import type { StepKind } from '../permissions';
import { isoDate, moneyString, pagination, sortDirection, uuid } from './common';

export const PR_LIST_SORT_FIELDS = [
  'number',
  'prDate',
  'status',
  'submittedAt',
  'createdAt',
  'updatedAt',
  'totalGrantCurrency',
] as const;
export type PrListSortField = (typeof PR_LIST_SORT_FIELDS)[number];

const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : [v]),
    z.array(item).optional()
  );

export const prListQuery = pagination.extend({
  status: oneOrMany(z.enum(PR_STATUSES)),
  officeId: uuid.optional(),
  grantId: uuid.optional(),
  requesterId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  amountMin: moneyString.optional(),
  amountMax: moneyString.optional(),
  /** PR number or line description (trigram-indexed `ilike`) */
  q: z.string().trim().max(100).optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/)
    .transform((v) => {
      const [field, direction] = v.split(':') as [string, z.infer<typeof sortDirection>];
      return { field, direction };
    })
    .refine((s) => (PR_LIST_SORT_FIELDS as readonly string[]).includes(s.field), {
      message: 'Unknown sort field',
    })
    .optional(),
});

export type PrListQuery = z.output<typeof prListQuery>;

interface OfficeRef {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
}

export interface PrListItem {
  id: string;
  number: string | null;
  status: PrStatus;
  prDate: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  office: OfficeRef | null;
  grant: { id: string; code: string; currency: string } | null;
  requester: { id: string; nameAr: string; nameEn: string };
  /** one total per line currency */
  totals: Money[];
  /** locked at submission; null for drafts */
  totalGrantCurrency: Money | null;
}

/** A pending step the caller may act on now. */
export interface MyTaskItem {
  prId: string;
  number: string | null;
  status: PrStatus;
  stepId: string;
  stepKind: StepKind;
  stepOrder: number;
  /** when the step became the current one (submission or the previous signature) */
  waitingSince: string;
  office: OfficeRef | null;
  grant: { id: string; code: string; currency: string } | null;
  requester: { id: string; nameAr: string; nameEn: string };
  totalGrantCurrency: Money | null;
  doaAmount: Money | null;
}
