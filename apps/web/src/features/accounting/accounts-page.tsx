'use client';

// Chart of accounts (002 US12): the account tree with deactivate / activate and delete (refused
// once the account is used), a form for a new account (a child takes its group's type), the
// expense account per budget category, the per-line override on a grant's budget lines, and the
// control accounts.
import {
  BUDGET_CATEGORIES,
  CONTROL_ACCOUNT_KEYS,
  GL_ACCOUNT_TYPES,
  PERMISSIONS_002,
  type ControlAccountKey,
  type GlAccountType,
  type GlAccountView,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useGrants } from '@/features/grants/api';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import {
  useBudgetLineAccounts,
  useCategoryMappings,
  useControlAccounts,
  useCreateGlAccount,
  useDeleteGlAccount,
  useGlAccounts,
  useSaveCategoryMappings,
  useSaveControlAccounts,
  useSetBudgetLineAccount,
  useUpdateGlAccount,
} from './api';

const NONE = '__none';

/** Accounts in tree order with their depth. */
function treeOrder(
  accounts: readonly GlAccountView[]
): { account: GlAccountView; depth: number }[] {
  const children = new Map<string | null, GlAccountView[]>();
  for (const a of accounts) {
    const list = children.get(a.parentId) ?? [];
    list.push(a);
    children.set(a.parentId, list);
  }
  const out: { account: GlAccountView; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of (children.get(parent) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
      out.push({ account: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** "10202 · Stationery" options for a select. */
function AccountOptions({ accounts }: { accounts: readonly GlAccountView[] }) {
  const localized = useLocalizedName();
  return (
    <>
      {accounts.map((a) => (
        <SelectItem key={a.id} value={a.id}>
          {a.code} · {localized(a)}
        </SelectItem>
      ))}
    </>
  );
}

function NewAccountForm({ groups }: { groups: readonly GlAccountView[] }) {
  const t = useTranslations('accounting.chart');
  const apiError = useApiError();
  const create = useCreateGlAccount();
  const [parentId, setParentId] = useState<string>(NONE);
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [type, setType] = useState<GlAccountType>('expense');
  const [isPosting, setIsPosting] = useState(true);
  const parent = groups.find((g) => g.id === parentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('newAccount')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="gl-parent">{t('parent')}</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="gl-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noParent')}</SelectItem>
                <AccountOptions accounts={groups} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-code">{t('code')}</Label>
            <Input id="gl-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-type">{t('type')}</Label>
            <Select
              value={parent?.type ?? type}
              disabled={!!parent}
              onValueChange={(v) => setType(v as GlAccountType)}
            >
              <SelectTrigger id="gl-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GL_ACCOUNT_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`types.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-name-ar">{t('nameAr')}</Label>
            <Input
              id="gl-name-ar"
              dir="rtl"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-name-en">{t('nameEn')}</Label>
            <Input
              id="gl-name-en"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="gl-posting"
              checked={isPosting}
              onCheckedChange={(v) => setIsPosting(v === true)}
            />
            <Label htmlFor="gl-posting">{t('posting')}</Label>
          </div>
        </div>
        {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}
        <Button
          disabled={create.isPending || !code.trim() || !nameAr.trim() || !nameEn.trim()}
          onClick={() =>
            create.mutate(
              {
                parentId: parentId === NONE ? null : parentId,
                code: code.trim(),
                nameAr: nameAr.trim(),
                nameEn: nameEn.trim(),
                type: parent?.type ?? type,
                isPosting,
              },
              {
                onSuccess: () => {
                  setCode('');
                  setNameAr('');
                  setNameEn('');
                },
              }
            )
          }
        >
          {t('add')}
        </Button>
      </CardContent>
    </Card>
  );
}

function ChartCard({ accounts, canManage }: { accounts: GlAccountView[]; canManage: boolean }) {
  const t = useTranslations('accounting.chart');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const update = useUpdateGlAccount();
  const remove = useDeleteGlAccount();
  const rows = useMemo(() => treeOrder(accounts), [accounts]);
  const error = update.error ?? remove.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{t('code')}</TableHead>
              <TableHead>{t('name')}</TableHead>
              <TableHead className="w-36">{t('type')}</TableHead>
              <TableHead className="w-28">{t('kind')}</TableHead>
              <TableHead className="w-28">{t('statusLabel')}</TableHead>
              {canManage ? <TableHead className="w-56" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ account: a, depth }) => (
              <TableRow key={a.id} className={a.isActive ? undefined : 'text-muted-foreground'}>
                <TableCell dir="ltr">
                  <span style={{ paddingInlineStart: `${depth * 1.25}rem` }}>{a.code}</span>
                </TableCell>
                <TableCell className={a.isPosting ? undefined : 'font-semibold'}>
                  {localized(a)}
                </TableCell>
                <TableCell>{t(`types.${a.type}`)}</TableCell>
                <TableCell>{a.isPosting ? t('posting') : t('group')}</TableCell>
                <TableCell>
                  <Badge variant="outline">{a.isActive ? t('active') : t('inactive')}</Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="space-x-2 text-end rtl:space-x-reverse">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: a.id,
                          expectedVersion: a.version,
                          isActive: !a.isActive,
                        })
                      }
                    >
                      {a.isActive ? t('deactivate') : t('activate')}
                    </Button>
                    {!a.inUse ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(a.id)}
                      >
                        {t('delete')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CategoryMappingCard({
  expenses,
  canManage,
}: {
  expenses: GlAccountView[];
  canManage: boolean;
}) {
  const t = useTranslations('accounting.mapping');
  const tb = useTranslations('budgetLines');
  const apiError = useApiError();
  const { data } = useCategoryMappings();
  const save = useSaveCategoryMappings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!data) return null;
  const value = (category: string) =>
    draft[category] ?? data.find((m) => m.category === category)?.expenseAccountId ?? NONE;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BUDGET_CATEGORIES.map((c) => (
            <div key={c} className="space-y-1">
              <Label htmlFor={`map-${c}`}>{tb(`categories.${c}`)}</Label>
              <Select
                value={value(c)}
                disabled={!canManage}
                onValueChange={(v) => setDraft((d) => ({ ...d, [c]: v }))}
              >
                <SelectTrigger id={`map-${c}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unmapped')}</SelectItem>
                  <AccountOptions accounts={expenses} />
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
        {canManage && Object.keys(draft).length > 0 ? (
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  mappings: Object.entries(draft)
                    .filter(([, id]) => id !== NONE)
                    .map(([category, expenseAccountId]) => ({
                      category: category as (typeof BUDGET_CATEGORIES)[number],
                      expenseAccountId,
                    })),
                },
                { onSuccess: () => setDraft({}) }
              )
            }
          >
            {t('save')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BudgetLineMappingCard({
  expenses,
  canManage,
}: {
  expenses: GlAccountView[];
  canManage: boolean;
}) {
  const t = useTranslations('accounting.lines');
  const apiError = useApiError();
  const grants = useGrants();
  const [grantId, setGrantId] = useState<string | undefined>();
  const { data } = useBudgetLineAccounts(grantId);
  const set = useSetBudgetLineAccount();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Select value={grantId} onValueChange={setGrantId}>
          <SelectTrigger className="w-full sm:w-72" aria-label={t('grant')}>
            <SelectValue placeholder={t('chooseGrant')} />
          </SelectTrigger>
          <SelectContent>
            {(grants.data?.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.code} · {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {set.error ? <ErrorText>{apiError(set.error)}</ErrorText> : null}
        {data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t('code')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="w-72">{t('override')}</TableHead>
                <TableHead className="w-40">{t('resolved')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((l) => (
                <TableRow key={l.budgetLineId}>
                  <TableCell dir="ltr">{l.code}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell>
                    <Select
                      value={l.expenseAccountId ?? NONE}
                      disabled={!canManage || set.isPending}
                      onValueChange={(v) =>
                        set.mutate({
                          budgetLineId: l.budgetLineId,
                          expenseAccountId: v === NONE ? null : v,
                        })
                      }
                    >
                      <SelectTrigger aria-label={t('override')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('categoryDefault')}</SelectItem>
                        <AccountOptions accounts={expenses} />
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell dir="ltr">
                    {l.resolvedAccountCode ?? (
                      <span className="text-destructive">{t('unmapped')}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ControlAccountsCard({
  posting,
  canManage,
}: {
  posting: GlAccountView[];
  canManage: boolean;
}) {
  const t = useTranslations('accounting.controls');
  const apiError = useApiError();
  const { data } = useControlAccounts();
  const save = useSaveControlAccounts();
  const [draft, setDraft] = useState<Partial<Record<ControlAccountKey, string>>>({});
  if (!data) return null;
  const orgWide = (key: ControlAccountKey) =>
    draft[key] ?? data.find((s) => s.key === key && s.grantId === null)?.accountId ?? NONE;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROL_ACCOUNT_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`ctl-${key}`}>{t(`keys.${key}`)}</Label>
              <Select
                value={orgWide(key)}
                disabled={!canManage}
                onValueChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              >
                <SelectTrigger id={`ctl-${key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unset')}</SelectItem>
                  <AccountOptions accounts={posting} />
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        {data.some((s) => s.grantId) ? (
          <p className="text-sm text-muted-foreground">
            {t('perGrant')}:{' '}
            {data
              .filter((s) => s.grantId)
              .map((s) => `${s.grantCode} → ${s.accountCode}`)
              .join(', ')}
          </p>
        ) : null}
        {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
        {canManage && Object.keys(draft).length > 0 ? (
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  settings: (Object.entries(draft) as [ControlAccountKey, string][])
                    .filter(([, id]) => id !== NONE)
                    .map(([key, accountId]) => ({ key, grantId: null, accountId })),
                },
                { onSuccess: () => setDraft({}) }
              )
            }
          >
            {t('save')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AccountsPage() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const has = useHasPermission();
  const canManage = has(PERMISSIONS_002.ACCOUNTS_MANAGE);
  const { data, error, isPending } = useGlAccounts();

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !data) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  const groups = data.filter((a) => !a.isPosting);
  const posting = data.filter((a) => a.isPosting && a.isActive);
  const expenses = posting.filter((a) => a.type === 'expense');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('chart.pageTitle')}</h1>
        <p className="text-muted-foreground">{t('chart.intro')}</p>
      </div>
      <ChartCard accounts={data} canManage={canManage} />
      {canManage ? <NewAccountForm groups={groups} /> : null}
      <CategoryMappingCard expenses={expenses} canManage={canManage} />
      <BudgetLineMappingCard expenses={expenses} canManage={canManage} />
      <ControlAccountsCard posting={posting} canManage={canManage} />
    </div>
  );
}
