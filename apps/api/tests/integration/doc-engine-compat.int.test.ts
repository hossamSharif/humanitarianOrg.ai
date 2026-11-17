// T005 — the generic document engine behind the 001 names (migration 0012, research D1): the
// PR steps and signatures live in doc_approval_step / doc_signature with the same ids; raw 001
// SQL and supabase-js keep working through the compatibility views (doc_type defaults to 'PR');
// signatures stay append-only on the base table; app.doc_ref_check refuses orphan rows; and
// app.block_delete_after_draft allows deleting only never-submitted drafts (FR-093). Also the
// 002 tenant seed hooks (0014, 0021): idempotent, lazy through app.ensure_tenant_seeds.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, cleanupTestData } from './helpers/factories';
import { as } from './helpers/http';
import { actOnStep, createFlow, submitPr, type Flow } from './helpers/pr-flow';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

async function pgError(promise: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { message: string; code?: string };
  }
  throw new Error('expected the statement to fail');
}

describe.runIf(integrationEnabled)('Document engine compatibility (002 D1)', () => {
  let flow: Flow;
  let prId: string;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    flow = await createFlow({ nameEn: 'Doc Engine Org' });
    ({ id: prId } = await submitPr(flow));
    expect((await actOnStep(flow.finance.token, prId, 'approve')).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('the 001 names are views over the generic tables', async () => {
    const rows = await ownerDb()<{ relname: string; relkind: string; invoker: boolean }[]>`
      select c.relname, c.relkind::text as relkind,
             coalesce('security_invoker=true' = any (c.reloptions), false) as invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('pr_approval_step', 'approval_action', 'doc_approval_step', 'doc_signature')
      order by c.relname`;
    expect(rows).toEqual([
      { relname: 'approval_action', relkind: 'v', invoker: true },
      { relname: 'doc_approval_step', relkind: 'r', invoker: false },
      { relname: 'doc_signature', relkind: 'r', invoker: false },
      { relname: 'pr_approval_step', relkind: 'v', invoker: true },
    ]);
  });

  it('PR steps and signatures written through the 001 paths are base rows with the same ids', async () => {
    const sql = ownerDb();
    const viewSteps = await sql<{ id: string }[]>`
      select id from public.pr_approval_step where pr_id = ${prId} order by step_order`;
    const baseSteps = await sql<{ id: string; doc_type: string; doc_id: string }[]>`
      select id, doc_type, doc_id from public.doc_approval_step where doc_id = ${prId}
      order by step_order`;
    expect(viewSteps).toHaveLength(2);
    expect(baseSteps.map((s) => s.id)).toEqual(viewSteps.map((s) => s.id));
    expect(new Set(baseSteps.map((s) => `${s.doc_type}:${s.doc_id}`))).toEqual(
      new Set([`PR:${prId}`])
    );

    const viewActions = await sql<{ id: string; action: string }[]>`
      select id, action from public.approval_action where pr_id = ${prId} order by acted_at`;
    const baseActions = await sql<{ id: string }[]>`
      select id from public.doc_signature where doc_type = 'PR' and doc_id = ${prId}
      order by acted_at`;
    expect(viewActions.map((a) => a.action)).toEqual(['submit', 'approve']);
    expect(baseActions.map((a) => a.id)).toEqual(viewActions.map((a) => a.id));
  });

  it('raw 001 SQL inserts into approval_action with pr_id; doc_type defaults to PR', async () => {
    const sql = ownerDb();
    const [row] = await sql<{ id: string }[]>`
      insert into public.approval_action
        (tenant_id, pr_id, cycle, action, user_id, user_name, comment)
      values (${flow.tenant.id}, ${prId}, 1, 'reassign', ${flow.admin.user.id}, 'Admin', 'cover')
      returning id`;
    const [base] = await sql<{ doc_type: string; doc_id: string }[]>`
      select doc_type, doc_id from public.doc_signature where id = ${row!.id}`;
    expect(base).toEqual({ doc_type: 'PR', doc_id: prId });
  });

  it('supabase-js reads pr_approval_step and approval_action through RLS', async () => {
    const client = anonClient(flow.finance.token);
    const steps = await client.from('pr_approval_step').select('id, pr_id, kind').eq('pr_id', prId);
    expect(steps.error).toBeNull();
    expect(steps.data?.map((s) => s.kind)).toEqual(['finance_check', 'final_approval']);

    const actions = await client.from('approval_action').select('action').eq('pr_id', prId);
    expect(actions.error).toBeNull();
    expect(actions.data?.length).toBeGreaterThanOrEqual(2);

    // another organization sees nothing
    const outsider = await createFlow({ nameEn: 'Outsider Org' });
    const hidden = await anonClient(outsider.finance.token)
      .from('pr_approval_step')
      .select('id')
      .eq('pr_id', prId);
    expect(hidden.data).toEqual([]);
  });

  it('doc_signature rejects update and delete, also for the table owner', async () => {
    const sql = ownerDb();
    const [sig] = await sql<{ id: string }[]>`
      select id from public.doc_signature where doc_id = ${prId} limit 1`;
    expect(
      (await pgError(sql`update public.doc_signature set comment = 'x' where id = ${sig!.id}`))
        .message
    ).toMatch(/APPEND_ONLY/);
    expect(
      (await pgError(sql`delete from public.doc_signature where id = ${sig!.id}`)).message
    ).toMatch(/APPEND_ONLY/);
  });

  it('authenticated users cannot update or delete signatures through the view either', async () => {
    const client = anonClient(flow.finance.token);
    const upd = await client.from('approval_action').update({ comment: 'x' }).eq('pr_id', prId);
    expect(upd.error).not.toBeNull();
    const del = await client.from('approval_action').delete().eq('pr_id', prId);
    expect(del.error).not.toBeNull();
  });

  it('app.doc_ref_check rejects a step or signature without its parent document', async () => {
    const sql = ownerDb();
    const [role] = await sql<{ id: string }[]>`
      select id from public.role where tenant_id = ${flow.tenant.id} limit 1`;
    const orphan = await pgError(sql`
      insert into public.doc_approval_step
        (tenant_id, doc_type, doc_id, cycle, step_order, kind, required_role_id)
      values (${flow.tenant.id}, 'PR', gen_random_uuid(), 1, 1, 'approval', ${role!.id})`);
    expect(orphan.message).toBe('NOT_FOUND');

    // a type whose table is not created yet has no parents at all
    const unregistered = await pgError(sql`
      insert into public.doc_signature (tenant_id, doc_type, doc_id, cycle, action, user_id, user_name)
      values (${flow.tenant.id}, 'PO', gen_random_uuid(), 1, 'submit', ${flow.admin.user.id}, 'A')`);
    expect(unregistered.message).toBe('NOT_FOUND');

    // the PR of another tenant is not a parent either
    const outsider = await createFlow({ nameEn: 'Ref Check Org' });
    const crossTenant = await pgError(sql`
      insert into public.doc_signature (tenant_id, doc_type, doc_id, cycle, action, user_id, user_name)
      values (${outsider.tenant.id}, 'PR', ${prId}, 1, 'submit', ${flow.admin.user.id}, 'A')`);
    expect(crossTenant.message).toBe('NOT_FOUND');
  });

  it('app.block_delete_after_draft: only an unsubmitted draft; status_only allows a numbered draft', async () => {
    const outcome = await ownerDb()
      .begin(async (sql) => {
        await sql`create temp table doc_t (id int primary key, status text, number text)`;
        await sql`
          create trigger block before delete on doc_t
          for each row execute function app.block_delete_after_draft()`;
        await sql`create temp table doc_s (id int primary key, status text, number text)`;
        await sql`
          create trigger block before delete on doc_s
          for each row execute function app.block_delete_after_draft('status_only')`;
        await sql`
          insert into doc_t values (1, 'draft', null), (2, 'pending_approval', 'X-1'),
                                   (3, 'draft', 'X-2')`;
        await sql`insert into doc_s values (1, 'draft', 'GRN-1'), (2, 'completed', 'GRN-2')`;

        const result: Record<string, string> = {};
        const attempt = async (label: string, statement: Promise<unknown>) => {
          await sql`savepoint s`;
          try {
            await statement;
            result[label] = 'deleted';
            await sql`release savepoint s`;
          } catch (err) {
            result[label] = (err as Error).message;
            await sql`rollback to savepoint s`;
          }
        };
        await attempt('unsubmitted draft', sql`delete from doc_t where id = 1`);
        await attempt('submitted', sql`delete from doc_t where id = 2`);
        await attempt('returned to draft with a number', sql`delete from doc_t where id = 3`);
        await attempt('numbered draft (status only)', sql`delete from doc_s where id = 1`);
        await attempt('completed (status only)', sql`delete from doc_s where id = 2`);
        throw Object.assign(new Error('rollback'), { result });
      })
      .catch((err: { result?: Record<string, string> }) => err.result);

    expect(outcome).toEqual({
      'unsubmitted draft': 'deleted',
      submitted: 'INVALID_STATE',
      'returned to draft with a number': 'INVALID_STATE',
      'numbered draft (status only)': 'deleted',
      'completed (status only)': 'INVALID_STATE',
    });
  });

  it('the PR history and workflow keep working after the move (submit → approve → history)', async () => {
    expect((await actOnStep(flow.approver.token, prId, 'approve')).status).toBe(200);
    const history = await as(flow.requester.token).get(`/prs/${prId}/history`);
    expect(history.status).toBe(200);
    expect(history.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['submit', 'approve'])
    );
  });
});

describe.runIf(integrationEnabled)('002 tenant seed hooks (0014, 0021)', () => {
  let flow: Flow;

  beforeAll(async () => {
    ensureMigrated();
    flow = await createFlow({ nameEn: 'Seed Hook Org' });
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('seed only when asked: a new organization keeps the 001 shape until a 002 feature runs', async () => {
    const [counts] = await ownerDb()<{ roles: number; rules: number }[]>`
      select (select count(*)::int from public.role where tenant_id = ${flow.tenant.id}) as roles,
             (select count(*)::int from public.approval_rule where tenant_id = ${flow.tenant.id}) as rules`;
    expect(counts).toEqual({ roles: 5, rules: 1 });
  });

  it('app.ensure_tenant_seeds seeds the roles, numbering, DoA rules, chart and periods once', async () => {
    const sql = ownerDb();
    const first = await sql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: flow.admin.user.id,
        role: 'authenticated',
        app_metadata: { tenant_id: flow.tenant.id },
      })}, true)`;
      const [row] = await tx<{ n: number }[]>`select app.ensure_tenant_seeds() as n`;
      return row!.n;
    });
    expect(first).toBe(2);
    const [again] = await sql<
      { n: number }[]
    >`select app.run_tenant_seed_hooks(${flow.tenant.id}) as n`;
    expect(again!.n).toBe(0);

    const roles = await sql<{ key: string }[]>`
      select key from public.role where tenant_id = ${flow.tenant.id} order by key`;
    expect(roles.map((r) => r.key)).toEqual(
      [
        'accountant',
        'approver',
        'cashier',
        'committee_member',
        'country_director',
        'finance_checker',
        'finance_manager',
        'org_admin',
        'procurement_officer',
        'requester',
        'storekeeper',
        'technical_inspector',
        'viewer',
      ].sort()
    );

    const rules = await sql<{ doc_type: string; kinds: string[] }[]>`
      select r.doc_type, array_agg(s.kind order by s.step_order) as kinds
      from public.approval_rule r join public.approval_rule_step s on s.rule_id = r.id
      where r.tenant_id = ${flow.tenant.id}
      group by r.doc_type order by r.doc_type`;
    expect(Object.fromEntries(rules.map((r) => [r.doc_type, r.kinds]))).toEqual({
      ADV: ['final_approval'],
      AMD: ['approval', 'final_approval'],
      AWARD: ['approval', 'final_approval'],
      CON: ['approval', 'final_approval'],
      DPR: ['finance_check', 'final_approval'],
      JV: ['check', 'final_approval'],
      PAY: ['finance_check', 'final_approval'],
      PO: ['approval', 'final_approval'],
      PR: ['finance_check', 'final_approval'],
      PV: ['check', 'final_approval'],
      RV: ['check', 'final_approval'],
      STL: ['final_approval'],
      WAIVER: ['approval', 'final_approval'],
    });

    const [numbering] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.numbering_config
      where tenant_id = ${flow.tenant.id} and doc_type <> 'PR' and prefix = doc_type`;
    expect(numbering!.n).toBe(20);

    const [admin] = await sql<{ codes: string[] }[]>`
      select array_agg(rp.permission_code) as codes from public.role_permission rp
      join public.role r on r.id = rp.role_id
      where r.tenant_id = ${flow.tenant.id} and r.key = 'org_admin'`;
    expect(admin!.codes).toContain('voucher:post');
    expect(admin!.codes).not.toContain('voucher:approve');
    expect(admin!.codes).not.toContain('pr:approve');

    const [chart] = await sql<{ accounts: number; periods: number; controls: number }[]>`
      select (select count(*)::int from public.gl_account where tenant_id = ${flow.tenant.id}) as accounts,
             (select count(*)::int from public.accounting_period where tenant_id = ${flow.tenant.id}) as periods,
             (select count(*)::int from public.control_account_setting where tenant_id = ${flow.tenant.id}) as controls`;
    expect(chart).toEqual({ accounts: 20, periods: 2, controls: 7 });
  });
});
