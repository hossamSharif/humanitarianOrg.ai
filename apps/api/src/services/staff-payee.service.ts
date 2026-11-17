// Staff payees (002 US2/US15/US16): staff paid by direct payment or advance. Duplicate bank
// accounts and phones across payees and suppliers are warnings (FR-012), never blocks.
import type {
  CreateStaffPayeeInput,
  ListResponse,
  StaffPayee,
  StaffPayeeListQuery,
  UpdateStaffPayeeInput,
} from '@ngo/shared';
import { withTenantTx, type TxSql } from '../db/tx';
import { AppError } from '../middleware/error';
import { StaffPayeeRepository } from '../repositories/staff-payee.repository';
import { partyDuplicates } from '../repositories/supplier.repository';
import type { RequestContext } from '../types/context';

export interface StaffPayeeRepos {
  sql: TxSql;
  payees: StaffPayeeRepository;
}

export interface StaffPayeeServiceDeps {
  run<T>(ctx: RequestContext, fn: (repos: StaffPayeeRepos) => Promise<T>): Promise<T>;
}

export const defaultStaffPayeeDeps: StaffPayeeServiceDeps = {
  run: (ctx, fn) =>
    withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
      fn({ sql: tx.sql, payees: new StaffPayeeRepository(tx.sql, ctx.tenantId) })
    ),
};

export class StaffPayeeService {
  constructor(private readonly deps: StaffPayeeServiceDeps = defaultStaffPayeeDeps) {}

  private async withWarnings(repos: StaffPayeeRepos, id: string): Promise<StaffPayee> {
    const payee = await repos.payees.getById(id);
    const duplicateWarnings = await partyDuplicates(
      repos.sql,
      { phone: payee.phone, bankAccountNo: payee.bankAccountNo },
      id
    );
    return { ...payee, duplicateWarnings };
  }

  private async assertMembership(repos: StaffPayeeRepos, membershipId?: string | null) {
    if (membershipId && !(await repos.payees.membershipExists(membershipId))) {
      throw new AppError('VALIDATION_ERROR', 'Unknown member', [
        { field: 'membershipId', message: 'invalid_reference' },
      ]);
    }
  }

  list(ctx: RequestContext, query: StaffPayeeListQuery): Promise<ListResponse<StaffPayee>> {
    const { page, pageSize, q, active } = query;
    return this.deps.run(ctx, ({ payees }) =>
      payees.list({ pagination: { page, pageSize }, q, active })
    );
  }

  get(ctx: RequestContext, id: string): Promise<StaffPayee> {
    return this.deps.run(ctx, (repos) => this.withWarnings(repos, id));
  }

  create(ctx: RequestContext, input: CreateStaffPayeeInput): Promise<StaffPayee> {
    return this.deps.run(ctx, async (repos) => {
      await this.assertMembership(repos, input.membershipId);
      return this.withWarnings(repos, await repos.payees.insert(input));
    });
  }

  update(ctx: RequestContext, id: string, input: UpdateStaffPayeeInput): Promise<StaffPayee> {
    const { expectedVersion, ...values } = input;
    return this.deps.run(ctx, async (repos) => {
      await this.assertMembership(repos, values.membershipId);
      await repos.payees.update(id, values, expectedVersion);
      return this.withWarnings(repos, id);
    });
  }
}
