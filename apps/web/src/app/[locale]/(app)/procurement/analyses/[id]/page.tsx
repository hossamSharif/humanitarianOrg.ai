'use client';

import { AnalysisDetail } from '@/features/analysis/analysis-detail';

export default function AnalysisPage({ params }: { params: { id: string } }) {
  return <AnalysisDetail id={params.id} />;
}
