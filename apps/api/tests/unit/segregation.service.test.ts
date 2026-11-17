// T006 — one test per separation-of-duties rule (contracts/rls-and-permissions.md §3, BR-8,
// SC-010): each asserts canSign returns the rule id as the reason code.
import { randomUUID } from 'node:crypto';
import { SEGREGATION_RULES } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import {
  assertCanSign,
  canSign,
  type PriorSignature,
  type SegregationDoc,
  type SignIntent,
} from '../../src/services/segregation.service';

const creator = randomUUID();
const other = randomUUID();
const third = randomUUID();

const step = (stepOrder: number, cycle = 1): Extract<SignIntent, { kind: 'step' }> => ({
  kind: 'step',
  stepKind: stepOrder === 1 ? 'approval' : 'final_approval',
  stepOrder,
  cycle,
});

const approved = (userId: string, stepOrder: number, cycle = 1): PriorSignature => ({
  userId,
  action: 'approve',
  cycle,
  stepOrder,
});

const doc = (docType: SegregationDoc['docType'], extra: Partial<SegregationDoc> = {}) => ({
  docType,
  creatorId: creator,
  ...extra,
});

describe('segregation policies (one test per rule id)', () => {
  it('creator_approves: the creator cannot sign an approval step of their own document', () => {
    for (const docType of ['PR', 'QA', 'WVR', 'PO', 'CON', 'AMD', 'ADV', 'STL'] as const) {
      expect(canSign(doc(docType), creator, step(1), [])).toEqual({
        ok: false,
        rule: 'creator_approves',
      });
    }
    expect(canSign(doc('PO'), other, step(1), [])).toEqual({ ok: true });
  });

  it('same_user_two_steps: one signer per step; re-signing the same step after a return is allowed', () => {
    const d = doc('PO');
    expect(canSign(d, other, step(2), [approved(other, 1)])).toEqual({
      ok: false,
      rule: 'same_user_two_steps',
    });
    // cycle 2, same step order 1 as in cycle 1 (001 FR-032)
    expect(canSign(d, other, step(1, 2), [approved(other, 1, 1)])).toEqual({ ok: true });
    // cycle 2, a different step than the one signed in cycle 1
    expect(canSign(d, other, step(2, 2), [approved(other, 1, 1)])).toEqual({
      ok: false,
      rule: 'same_user_two_steps',
    });
  });

  it('pr_creator_approves_award: a requester of a PR in the sourcing cannot approve the award', () => {
    const d = doc('QA', { prRequesterIds: [third] });
    expect(canSign(d, third, step(1), [])).toEqual({
      ok: false,
      rule: 'pr_creator_approves_award',
    });
    expect(canSign(d, other, step(1), [])).toEqual({ ok: true });
  });

  it('receiver_is_inspector: the received and inspected signatures come from two people', () => {
    const received: PriorSignature = {
      userId: other,
      action: 'received',
      cycle: 1,
      stepOrder: null,
    };
    expect(canSign(doc('GRN'), other, { kind: 'inspected' }, [received])).toEqual({
      ok: false,
      rule: 'receiver_is_inspector',
    });
    const inspected: PriorSignature = { ...received, action: 'inspected' };
    expect(canSign(doc('GRN'), other, { kind: 'received' }, [inspected])).toEqual({
      ok: false,
      rule: 'receiver_is_inspector',
    });
    expect(canSign(doc('GRN'), third, { kind: 'inspected' }, [received])).toEqual({ ok: true });
  });

  it('certifier_is_confirmer: the certified and confirmed signatures come from two people', () => {
    const certified: PriorSignature = {
      userId: other,
      action: 'certified',
      cycle: 1,
      stepOrder: null,
    };
    expect(canSign(doc('SCC'), other, { kind: 'confirmed' }, [certified])).toEqual({
      ok: false,
      rule: 'certifier_is_confirmer',
    });
    expect(canSign(doc('SCC'), third, { kind: 'confirmed' }, [certified])).toEqual({ ok: true });
  });

  it('preparer_approves_payment: the preparer of a payment request signs none of its steps', () => {
    for (const docType of ['PAY', 'DPR'] as const) {
      expect(canSign(doc(docType), creator, { ...step(1), stepKind: 'finance_check' }, [])).toEqual(
        { ok: false, rule: 'preparer_approves_payment' }
      );
    }
  });

  it('receiver_approves_payment: a receiver, inspector or certifier of the matched receipts cannot sign', () => {
    const d = doc('PAY', { receiptSignerIds: [third] });
    expect(canSign(d, third, step(2), [])).toEqual({
      ok: false,
      rule: 'receiver_approves_payment',
    });
    expect(canSign(d, other, step(2), [])).toEqual({ ok: true });
  });

  it('voucher_three_people: entered by ≠ checked by ≠ approved by', () => {
    for (const docType of ['BPV', 'CPV', 'BRV', 'CRV', 'JV', 'TRF'] as const) {
      const check: SignIntent = { kind: 'step', stepKind: 'check', stepOrder: 1, cycle: 1 };
      // the person who entered it checks it
      expect(canSign(doc(docType), creator, check, [])).toEqual({
        ok: false,
        rule: 'voucher_three_people',
      });
      // the checker also approves it
      expect(canSign(doc(docType), other, step(2), [approved(other, 1)])).toEqual({
        ok: false,
        rule: 'voucher_three_people',
      });
      expect(canSign(doc(docType), third, step(2), [approved(other, 1)])).toEqual({ ok: true });
    }
  });

  it('override_by_preparer: the preparer cannot override the match of their own request', () => {
    expect(canSign(doc('PAY'), creator, { kind: 'override_match' }, [])).toEqual({
      ok: false,
      rule: 'override_by_preparer',
    });
    expect(canSign(doc('PAY'), other, { kind: 'override_match' }, [])).toEqual({ ok: true });
  });

  it('undeclared_member_scores: only a member who declared no conflict may score', () => {
    expect(canSign(doc('QA', { declaration: null }), other, { kind: 'score' }, [])).toEqual({
      ok: false,
      rule: 'undeclared_member_scores',
    });
    expect(
      canSign(doc('QA', { declaration: { hasConflict: true } }), other, { kind: 'score' }, [])
    ).toEqual({ ok: false, rule: 'undeclared_member_scores' });
    expect(
      canSign(doc('QA', { declaration: { hasConflict: false } }), other, { kind: 'score' }, [])
    ).toEqual({ ok: true });
  });

  it('covers every rule id of the contract', () => {
    expect([...SEGREGATION_RULES].sort()).toEqual(
      [
        'creator_approves',
        'same_user_two_steps',
        'pr_creator_approves_award',
        'receiver_is_inspector',
        'certifier_is_confirmer',
        'preparer_approves_payment',
        'receiver_approves_payment',
        'voucher_three_people',
        'override_by_preparer',
        'undeclared_member_scores',
      ].sort()
    );
  });
});

describe('assertCanSign', () => {
  it('throws 403 SEGREGATION_OF_DUTIES with details.rule', () => {
    let error: unknown;
    try {
      assertCanSign(doc('PO'), creator, step(1), []);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('SEGREGATION_OF_DUTIES');
    expect((error as AppError).status).toBe(403);
    expect((error as AppError).details).toEqual({ rule: 'creator_approves' });
  });

  it('uses the type-specific message when given', () => {
    expect(() =>
      assertCanSign(doc('PR'), creator, step(1), [], { creator_approves: 'PR message' })
    ).toThrow('PR message');
  });
});
