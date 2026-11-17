'use client';

// Bank accounts and cash boxes (002 US12): each with its currency, office and own ledger account
// (a posting asset account), an opening balance and date; a cash box has a custodian. The
// currency and the ledger account never change; an account is deactivated, not deleted.
import { PERMISSIONS_002, formatDate, type MoneyAccountView } from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
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
import { useState } from 'react';
import { useOffices } from '@/features/grants/api';
import { Amount, ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useUsers } from '@/features/users/api';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import {
  useCreateMoneyAccount,
  useGlAccounts,
  useMoneyAccountList,
  useUpdateMoneyAccount,
} from './api';

const NONE = '__none';

function NewMoneyAccountForm({ kind }: { kind: 'bank' | 'cash' }) {
  const t = useTranslations('accounting.money');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const offices = useOffices();
  const users = useUsers({ page: 1, status: 'active' });
  const assets = useGlAccounts({ type: 'asset', postingOnly: true });
  const all = useMoneyAccountList(kind === 'bank' ? 'cash' : 'bank');
  const mine = useMoneyAccountList(kind);
  const create = useCreateMoneyAccount(kind);
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [currency, setCurrency] = useState('');
  const [officeId, setOfficeId] = useState<string | undefined>();
  const [glAccountId, setGlAccountId] = useState<string | undefined>();
  const [custodian, setCustodian] = useState<string>(NONE);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingDate, setOpeningDate] = useState<string | null>(null);

  // a ledger account belongs to one money account only
  const taken = new Set([...(all.data ?? []), ...(mine.data ?? [])].map((a) => a.glAccountId));
  const freeAssets = (assets.data ?? []).filter((a) => a.isActive && !taken.has(a.id));
  const ready =
    name.trim() &&
    /^[A-Z]{3}$/.test(currency) &&
    officeId &&
    glAccountId &&
    (kind === 'cash' || (bankName.trim() && accountNo.trim()));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t(kind === 'bank' ? 'newBank' : 'newCash')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`${kind}-name`}>{t('name')}</Label>
            <Input id={`${kind}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {kind === 'bank' ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="bank-bank">{t('bankName')}</Label>
                <Input
                  id="bank-bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bank-branch">{t('branch')}</Label>
                <Input
                  id="bank-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bank-no">{t('accountNo')}</Label>
                <Input
                  id="bank-no"
                  dir="ltr"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="cash-custodian">{t('custodian')}</Label>
              <Select value={custodian} onValueChange={setCustodian}>
                <SelectTrigger id="cash-custodian">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('noCustodian')}</SelectItem>
                  {(users.data?.data ?? []).map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {localized({ nameAr: u.fullNameAr, nameEn: u.fullNameEn })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${kind}-currency`}>{t('currency')}</Label>
            <Input
              id={`${kind}-currency`}
              dir="ltr"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-office`}>{t('office')}</Label>
            <Select value={officeId} onValueChange={setOfficeId}>
              <SelectTrigger id={`${kind}-office`}>
                <SelectValue placeholder={t('chooseOffice')} />
              </SelectTrigger>
              <SelectContent>
                {(offices.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.code} · {localized(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-gl`}>{t('glAccount')}</Label>
            <Select value={glAccountId} onValueChange={setGlAccountId}>
              <SelectTrigger id={`${kind}-gl`}>
                <SelectValue placeholder={t('chooseGl')} />
              </SelectTrigger>
              <SelectContent>
                {freeAssets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {localized(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-opening`}>{t('openingBalance')}</Label>
            <Input
              id={`${kind}-opening`}
              dir="ltr"
              inputMode="decimal"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-opening-date`}>{t('openingDate')}</Label>
            <DateInput id={`${kind}-opening-date`} value={openingDate} onChange={setOpeningDate} />
          </div>
        </div>
        {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}
        <Button
          disabled={!ready || create.isPending}
          onClick={() =>
            create.mutate(
              {
                name: name.trim(),
                currency,
                officeId: officeId!,
                glAccountId: glAccountId!,
                openingBalance: openingBalance || '0',
                openingDate,
                ...(kind === 'bank'
                  ? {
                      bankName: bankName.trim(),
                      branch: branch.trim() || null,
                      accountNo: accountNo.trim(),
                    }
                  : { custodianUserId: custodian === NONE ? null : custodian }),
              },
              { onSuccess: () => setName('') }
            )
          }
        >
          {t('add')}
        </Button>
      </CardContent>
    </Card>
  );
}

function MoneyAccountTable({ kind, canManage }: { kind: 'bank' | 'cash'; canManage: boolean }) {
  const t = useTranslations('accounting.money');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const { data, error, isPending } = useMoneyAccountList(kind);
  const update = useUpdateMoneyAccount(kind);
  const toggle = (a: MoneyAccountView) =>
    update.mutate({ id: a.id, expectedVersion: a.version, isActive: !a.isActive });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t(kind === 'bank' ? 'banks' : 'cashBoxes')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
        {update.error ? <ErrorText>{apiError(update.error)}</ErrorText> : null}
        {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
        {data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                {kind === 'bank' ? <TableHead>{t('bankName')}</TableHead> : null}
                {kind === 'bank' ? <TableHead className="w-40">{t('accountNo')}</TableHead> : null}
                <TableHead className="w-20">{t('currency')}</TableHead>
                <TableHead className="w-24">{t('office')}</TableHead>
                <TableHead className="w-28">{t('glAccount')}</TableHead>
                <TableHead className="w-44 text-end">{t('openingBalance')}</TableHead>
                <TableHead className="w-28">{t('statusLabel')}</TableHead>
                {canManage ? <TableHead className="w-32" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id} className={a.isActive ? undefined : 'text-muted-foreground'}>
                  <TableCell>{a.name}</TableCell>
                  {kind === 'bank' ? (
                    <TableCell>{[a.bankName, a.branch].filter(Boolean).join(' – ')}</TableCell>
                  ) : null}
                  {kind === 'bank' ? <TableCell dir="ltr">{a.accountNo}</TableCell> : null}
                  <TableCell dir="ltr">{a.currency}</TableCell>
                  <TableCell dir="ltr">{a.officeCode}</TableCell>
                  <TableCell dir="ltr">{a.glAccountCode}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={a.openingBalance} currency={a.currency} />
                    {a.openingDate ? (
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {formatDate(a.openingDate)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.isActive ? t('active') : t('inactive')}</Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() => toggle(a)}
                      >
                        {a.isActive ? t('deactivate') : t('activate')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {data && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BankCashPage() {
  const t = useTranslations('accounting.money');
  const has = useHasPermission();
  const canManage = has(PERMISSIONS_002.BANK_MANAGE);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <MoneyAccountTable kind="bank" canManage={canManage} />
      {canManage ? <NewMoneyAccountForm kind="bank" /> : null}
      <MoneyAccountTable kind="cash" canManage={canManage} />
      {canManage ? <NewMoneyAccountForm kind="cash" /> : null}
    </div>
  );
}
