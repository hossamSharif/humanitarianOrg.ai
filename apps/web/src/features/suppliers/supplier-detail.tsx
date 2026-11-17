'use client';

// Supplier page (002 US2): details and bank details, categories, documents with expiry,
// vetting records, status with reason, duplicate warnings for Finance (FR-012), ratings.
import { PERMISSIONS_002, formatDate, type Supplier, type SupplierStatus } from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ErrorText, WarningBanner, useLocalizedName } from '@/features/grants/shared';
import { useCategories } from '@/features/procurement-settings/api';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useSupplier } from './api';
import { ComplianceBadges, SupplierStatusBadge } from './supplier-badges';
import {
  SupplierDocumentDialog,
  SupplierStatusDialog,
  SupplierVettingDialog,
} from './supplier-dialogs';
import { SupplierFormDialog } from './supplier-form-dialog';

function Item({ label, children, ltr }: { label: string; children: ReactNode; ltr?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium" dir={ltr ? 'ltr' : undefined}>
        {children || '—'}
      </dd>
    </div>
  );
}

function Ratings({ ratings }: { ratings: Supplier['ratings'] }) {
  const t = useTranslations('suppliers.ratings');
  if (ratings.count === 0) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <dl className="grid gap-4 sm:grid-cols-4">
      <Item label={t('onTime')} ltr>
        {t('outOf', { value: ratings.onTime ?? '' })}
      </Item>
      <Item label={t('quality')} ltr>
        {t('outOf', { value: ratings.quality ?? '' })}
      </Item>
      <Item label={t('documentation')} ltr>
        {t('outOf', { value: ratings.documentation ?? '' })}
      </Item>
      <Item label={t('count')} ltr>
        {ratings.count}
      </Item>
    </dl>
  );
}

export function SupplierDetail({ id }: { id: string }) {
  const t = useTranslations('suppliers');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const can = useHasPermission();
  const categories = useCategories('supplier');
  const { data: supplier, error, isPending } = useSupplier(id);
  const [editing, setEditing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [addingDocument, setAddingDocument] = useState(false);
  const [addingVetting, setAddingVetting] = useState(false);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !supplier) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  const canManage = can(PERMISSIONS_002.SUPPLIERS_MANAGE);
  const canVet = can(PERMISSIONS_002.SUPPLIERS_VET);
  const allowedStatus = (s: SupplierStatus) => (s === 'approved' ? canVet : canManage);
  const showDuplicates =
    supplier.duplicateWarnings.length > 0 &&
    can(PERMISSIONS_002.FINANCE_READ, PERMISSIONS_002.SUPPLIERS_VET);
  const categoryNames = new Map((categories.data?.data ?? []).map((c) => [c.id, localized(c)]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/procurement/suppliers"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t('backToList')}
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            {localized({ nameAr: supplier.legalNameAr, nameEn: supplier.legalNameEn })}
            <SupplierStatusBadge status={supplier.status} />
          </h1>
          <p className="text-muted-foreground" lang="ar" dir="rtl">
            {supplier.legalNameAr}
          </p>
          <p className="text-muted-foreground" lang="en" dir="ltr">
            {supplier.legalNameEn}
          </p>
          <ComplianceBadges compliance={supplier.compliance} />
        </div>
        <div className="flex gap-2">
          {canManage || canVet ? (
            <Button variant="outline" onClick={() => setChangingStatus(true)}>
              {t('changeStatus')}
            </Button>
          ) : null}
          {canManage ? <Button onClick={() => setEditing(true)}>{t('edit')}</Button> : null}
        </div>
      </div>

      {supplier.statusReason ? (
        <WarningBanner>
          {t('statusReason')}: {supplier.statusReason}
        </WarningBanner>
      ) : null}

      {showDuplicates ? (
        <WarningBanner>
          <p className="font-medium">{t('duplicates.title')}</p>
          <ul className="mt-1 list-disc ps-5">
            {supplier.duplicateWarnings.map((d) => (
              <li key={`${d.partyId}:${d.field}`}>
                {t('duplicates.item', {
                  name: localized({ nameAr: d.nameAr, nameEn: d.nameEn }),
                  kind: t(`duplicates.kinds.${d.partyKind}`),
                  field: t(`duplicates.fields.${d.field}`),
                })}
              </li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('details')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Item label={t('form.type')}>{t(`types.${supplier.type}`)}</Item>
            <Item label={t('form.tradeName')}>{supplier.tradeName}</Item>
            <Item label={t('form.registrationNo')} ltr>
              {supplier.registrationNo}
            </Item>
            <Item label={t('form.taxNo')} ltr>
              {supplier.taxNo}
            </Item>
            <Item label={t('form.phone')} ltr>
              {supplier.phone}
            </Item>
            <Item label={t('form.email')} ltr>
              {supplier.email}
            </Item>
            <Item label={t('form.contactPerson')}>{supplier.contactPerson}</Item>
            <Item label={t('form.city')}>{supplier.city}</Item>
            <Item label={t('form.address')}>{supplier.address}</Item>
            <Item label={t('lastVetted')} ltr>
              {supplier.lastVettedAt ? formatDate(supplier.lastVettedAt) : null}
            </Item>
            <Item label={t('categories')}>
              <span className="flex flex-wrap gap-1">
                {supplier.categoryIds.map((cid) => (
                  <Badge key={cid} variant="outline">
                    {categoryNames.get(cid) ?? ''}
                  </Badge>
                ))}
              </span>
            </Item>
          </dl>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('form.bankDetails')}</h3>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Item label={t('form.bankName')}>{supplier.bankName}</Item>
              <Item label={t('form.bankBranch')}>{supplier.bankBranch}</Item>
              <Item label={t('form.bankAccountName')}>{supplier.bankAccountName}</Item>
              <Item label={t('form.bankAccountNo')} ltr>
                {supplier.bankAccountNo}
              </Item>
            </dl>
          </div>
          {supplier.notes ? <Item label={t('form.notes')}>{supplier.notes}</Item> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('documents.title')}</CardTitle>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setAddingDocument(true)}>
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('documents.add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {supplier.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('documents.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('documents.kind')}</TableHead>
                    <TableHead>{t('documents.number')}</TableHead>
                    <TableHead>{t('documents.issueDate')}</TableHead>
                    <TableHead>{t('documents.expiryDate')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.documents.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        {t(`documents.kinds.${d.docKind}`)}
                        {d.isRequired ? (
                          <span className="ms-2 text-xs text-muted-foreground">
                            ({t('documents.requiredShort')})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell dir="ltr">{d.number ?? '—'}</TableCell>
                      <TableCell dir="ltr" className="tabular-nums">
                        {d.issueDate ? formatDate(d.issueDate) : '—'}
                      </TableCell>
                      <TableCell dir="ltr" className="tabular-nums">
                        {d.expiryDate ? formatDate(d.expiryDate) : '—'}
                      </TableCell>
                      <TableCell>
                        {d.expired ? (
                          <Badge variant={d.isRequired ? 'destructive' : 'outline'}>
                            {t('documents.expired')}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('vetting.title')}</CardTitle>
          {canVet ? (
            <Button size="sm" variant="outline" onClick={() => setAddingVetting(true)}>
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('vetting.add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {supplier.vettings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('vetting.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('vetting.checkedOn')}</TableHead>
                    <TableHead>{t('vetting.listsChecked')}</TableHead>
                    <TableHead>{t('vetting.result')}</TableHead>
                    <TableHead>{t('vetting.checkedBy')}</TableHead>
                    <TableHead>{t('vetting.notes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.vettings.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell dir="ltr" className="tabular-nums">
                        {formatDate(v.checkedOn)}
                      </TableCell>
                      <TableCell dir="ltr">{v.listsChecked.join(', ')}</TableCell>
                      <TableCell>
                        <Badge variant={v.result === 'clear' ? 'default' : 'destructive'}>
                          {t(`vetting.results.${v.result}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{v.checkedByName}</TableCell>
                      <TableCell className="text-sm">{v.notes ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ratings.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Ratings ratings={supplier.ratings} />
        </CardContent>
      </Card>

      <SupplierFormDialog open={editing} onOpenChange={setEditing} supplier={supplier} />
      <SupplierStatusDialog
        open={changingStatus}
        onOpenChange={setChangingStatus}
        supplier={supplier}
        allowed={allowedStatus}
      />
      <SupplierDocumentDialog
        open={addingDocument}
        onOpenChange={setAddingDocument}
        supplier={supplier}
      />
      <SupplierVettingDialog
        open={addingVetting}
        onOpenChange={setAddingVetting}
        supplier={supplier}
      />
    </div>
  );
}
