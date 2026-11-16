// Seeds many approved PRs in a few set-based statements (performance tests, SC-004 / FR-046).
// Each PR gets `linesPerPr` lines of 1 × 600.00 SDG (= 1.00 USD at the flow's rate) charged to one
// budget line, chosen round-robin, and one committed budget_commitment for that line. Rows are
// written with the table-owner connection, so RLS is bypassed but every trigger still runs.
import { ownerDb } from './setup';
import type { TestTenant, TestUser } from './factories';

export async function seedApprovedPrs(
  tenant: TestTenant,
  requester: TestUser,
  options: {
    grantId: string;
    budgetLineIds: readonly string[];
    count: number;
    linesPerPr: number;
    prDate: string;
    office?: string;
    /** number prefix; numbers are `${prefix}-${000001}` */
    prefix?: string;
  }
): Promise<void> {
  const sql = ownerDb();
  const officeId = tenant.offices[options.office ?? 'MAD']!;
  const prefix = options.prefix ?? 'BULK';
  const n = options.budgetLineIds.length;

  await sql.begin(async (tx) => {
    await tx`
      insert into public.purchase_requisition
        (tenant_id, number, status, pr_date, requesting_office_id, grant_id,
         deliver_to_office_id, pr_type, requester_id, created_by, requester_name,
         requester_position, submission_cycle, total_grant_currency, doa_currency, doa_amount,
         submitted_at, approved_at)
      select ${tenant.id}, ${prefix} || '-' || lpad(i::text, 6, '0'), 'approved',
             ${options.prDate}::date, ${officeId}, ${options.grantId}, ${officeId}, 'goods',
             ${requester.id}, ${requester.id}, 'Test User', 'Officer', 1,
             ${options.linesPerPr}::numeric, 'USD', ${options.linesPerPr}::numeric, now(), now()
      from generate_series(1, ${options.count}) as i`;

    await tx`
      insert into public.pr_line
        (tenant_id, pr_id, line_no, description, quantity, unit_id, unit_cost, currency,
         budget_line_id, location_office_id, rate_to_base, rate_date, rate_source, amount_grant)
      select p.tenant_id, p.id, k, 'Bulk item ' || k, 1, ${tenant.unitId}, 600, 'SDG', bl.id,
             ${officeId}, 1, p.pr_date, 'base', 1.00
      from public.purchase_requisition p
      cross join generate_series(1, ${options.linesPerPr}) as k
      -- PR n charges budget line (n mod count) + 1, in the given order
      join unnest(${tx.array([...options.budgetLineIds])}::uuid[]) with ordinality as bl(id, ord)
        on bl.ord = right(p.number, 6)::int % ${n} + 1
      where p.tenant_id = ${tenant.id} and p.number like ${prefix + '-%'}`;

    await tx`
      insert into public.budget_commitment
        (tenant_id, budget_line_id, pr_id, cycle, amount, status, reserved_at, committed_at)
      select l.tenant_id, l.budget_line_id, l.pr_id, 1, sum(l.amount_grant), 'committed', now(),
             now()
      from public.pr_line l
      join public.purchase_requisition p on p.id = l.pr_id
      where p.tenant_id = ${tenant.id} and p.number like ${prefix + '-%'}
      group by l.tenant_id, l.budget_line_id, l.pr_id`;
  });
}

/** p-th percentile (0–100) of the samples, nearest-rank. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Wall-clock milliseconds of `fn`. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}
