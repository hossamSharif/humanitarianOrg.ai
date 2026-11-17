'use client';

// Invited suppliers (002 US3, US2-1): pick approved suppliers with the invitation channel;
// overdue vetting and expired documents show as warnings, never blocks. The count against the
// required minimum is shown (US3-4: issuing below it needs an approved waiver).
import {
  INVITATION_CHANNELS,
  formatDate,
  type InvitationChannel,
  type SourcingEventDetail,
  type SupplierSummary,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  toast,
} from '@ngo/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { ComplianceBadges, SupplierStatusBadge } from '@/features/suppliers/supplier-badges';
import { SupplierPicker } from '@/features/suppliers/supplier-picker';
import { useApiError } from '@/lib/use-api-error';
import { useUpdateRfq } from './api';

interface Row {
  supplierId: string;
  nameAr: string;
  nameEn: string;
  channel: InvitationChannel;
  invitedOn: string | null;
  badges: ReactNode;
}

export function InvitationsEditor({
  event,
  editable,
  renderActions,
}: {
  event: SourcingEventDetail;
  editable: boolean;
  /** extra per-supplier actions (the RFQ print) */
  renderActions?: (supplierId: string) => ReactNode;
}) {
  const t = useTranslations('sourcing.invitations');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const update = useUpdateRfq(event.id);

  const fromServer = (): Row[] =>
    event.invitations.map((i) => ({
      supplierId: i.supplierId,
      nameAr: i.supplierNameAr,
      nameEn: i.supplierNameEn,
      channel: i.channel,
      invitedOn: i.invitedOn,
      badges: (
        <>
          {i.supplierStatus !== 'approved' ? (
            <SupplierStatusBadge status={i.supplierStatus} />
          ) : null}
          <ComplianceBadges compliance={i.compliance} />
        </>
      ),
    }));
  const [rows, setRows] = useState<Row[]>(fromServer);
  const [channel, setChannel] = useState<InvitationChannel>('email');

  useEffect(() => {
    setRows(fromServer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.invitations]);

  const add = (s: SupplierSummary) => {
    if (rows.some((r) => r.supplierId === s.id)) return;
    setRows((rs) => [
      ...rs,
      {
        supplierId: s.id,
        nameAr: s.legalNameAr,
        nameEn: s.legalNameEn,
        channel,
        invitedOn: null,
        badges: (
          <>
            {s.status !== 'approved' ? <SupplierStatusBadge status={s.status} /> : null}
            <ComplianceBadges compliance={s.compliance} />
          </>
        ),
      },
    ]);
  };

  const save = () =>
    update.mutate(
      {
        expectedVersion: event.version,
        invitations: rows.map((r) => ({
          supplierId: r.supplierId,
          channel: r.channel,
          ...(r.invitedOn ? { invitedOn: r.invitedOn } : {}),
        })),
      },
      { onSuccess: () => toast({ description: t('saved') }) }
    );

  const required = event.method.requiredMinQuotations;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <Badge variant={rows.length >= required ? 'secondary' : 'destructive'}>
          {t('count', { count: rows.length, required })}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <SupplierPicker value={null} onChange={add} />
            <Select value={channel} onValueChange={(v) => setChannel(v as InvitationChannel)}>
              <SelectTrigger aria-label={t('channel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITATION_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`channels.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('supplier')}</TableHead>
                  <TableHead className="w-44">{t('channel')}</TableHead>
                  <TableHead className="w-32">{t('invitedOn')}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplierId}>
                    <TableCell>
                      <span className="font-medium">{localized(r)}</span>
                      <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
                        {r.badges}
                      </span>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Select
                          value={r.channel}
                          onValueChange={(v) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.supplierId === r.supplierId
                                  ? { ...x, channel: v as InvitationChannel }
                                  : x
                              )
                            )
                          }
                        >
                          <SelectTrigger aria-label={t('channel')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INVITATION_CHANNELS.map((c) => (
                              <SelectItem key={c} value={c}>
                                {t(`channels.${c}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        t(`channels.${r.channel}`)
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {r.invitedOn ? formatDate(r.invitedOn) : '—'}
                    </TableCell>
                    <TableCell className="text-end">
                      {editable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove')}
                          onClick={() =>
                            setRows((rs) => rs.filter((x) => x.supplierId !== r.supplierId))
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      ) : (
                        renderActions?.(r.supplierId)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {update.error ? <ErrorText>{apiError(update.error)}</ErrorText> : null}
        {editable ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={update.isPending}>
              {tc('save')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
