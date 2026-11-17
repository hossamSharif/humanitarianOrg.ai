'use client';

// Approval route of the PR's current submission cycle and its signatures (FR-031) — the shared
// document steps view with the PR messages.
import type { PrDetail } from '@ngo/shared';
import { StepsView } from '@/features/documents/steps-view';

export function PrStepsView({ pr }: { pr: PrDetail }) {
  return (
    <StepsView
      cycle={pr.submissionCycle}
      steps={pr.steps}
      signatures={pr.actions}
      namespace="pr.steps"
      headingId="pr-steps-view"
    />
  );
}
