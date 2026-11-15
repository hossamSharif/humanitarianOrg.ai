// TanStack Query keys, one factory per resource; features add theirs here.
export const queryKeys = {
  me: ['me'] as const,
  notifications: {
    all: ['notifications'] as const,
    unread: ['notifications', 'unread'] as const,
  },
  prs: {
    all: ['prs'] as const,
    list: (filters: Record<string, unknown>) => ['prs', 'list', filters] as const,
    detail: (id: string) => ['prs', 'detail', id] as const,
    myTasks: ['prs', 'my-tasks'] as const,
  },
  grants: {
    all: ['grants'] as const,
    detail: (id: string) => ['grants', 'detail', id] as const,
    budgetLines: (id: string) => ['grants', id, 'budget-lines'] as const,
    list: (filters: Record<string, unknown>) => ['grants', 'list', filters] as const,
    activities: (id: string) => ['grants', id, 'activities'] as const,
  },
  donors: {
    all: ['donors'] as const,
    list: (filters: Record<string, unknown>) => ['donors', 'list', filters] as const,
  },
  rates: {
    all: ['exchange-rates'] as const,
    list: (filters: Record<string, unknown>) => ['exchange-rates', 'list', filters] as const,
  },
};
