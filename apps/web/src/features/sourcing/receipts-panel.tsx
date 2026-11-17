'use client';

// Quotation receipts and the opening (002 US4, research D3). Before the opening there is no
// price or file input anywhere: a receipt is the supplier, the time and the receiver. The
// opening dialog is disabled until the deadline passes (by the database clock, the API checks
// again), takes at least two attendees and accepts late offers only with a reason.
import {
  formatDateTime,
  isoToZonedDateTime,
  zonedDateTimeToIso,
  type OfferStatus,
  type SourcingEventDetail,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Textarea,
} from '@ngo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { useUsers } from '@/features/users/api';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { useLogReceipt, useOpenRfq } from './api';

const TONE: Record<OfferStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  logged: 'secondary',
  late_accepted: 'secondary',
  replaced: 'outline',
  late: 'destructive',
  withdrawn: 'outline',
  disqualified: 'destructive',
};

/** Active members to pick as receiver or attendee; empty when the caller cannot list users. */
function useMembers() {
  const users = useUsers({ page: 1, status: 'active' });
  return users.data?.data ?? [];
}

function ReceiptForm({ event, onDone }: { event: SourcingEventDetail; onDone: () => void }) {
  const t = useTranslations('sourcing.receipts');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const timeZone = useTenantTimeZone();
  const me = useMe();
  const members = useMembers();
  const log = useLogReceipt(event.id);
  const now = isoToZonedDateTime(new Date().toISOString(), timeZone);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState<string | null>(now.date);
  const [time, setTime] = useState(now.time);
  const [receiverId, setReceiverId] = useState<string>('');
  const receiver = receiverId || me.data?.user.id || '';

  const submit = () =>
    log.mutate(
      {
        supplierId,
        receivedAt: zonedDateTimeToIso(date!, time, timeZone),
        receivedById: receiver,
      },
      { onSuccess: onDone }
    );

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="receipt-supplier">{t('supplier')}</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger id="receipt-supplier">
              <SelectValue placeholder={t('chooseSupplier')} />
            </SelectTrigger>
            <SelectContent>
              {event.invitations.map((i) => (
                <SelectItem key={i.supplierId} value={i.supplierId}>
                  {localized({ nameAr: i.supplierNameAr, nameEn: i.supplierNameEn })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-date">{t('receivedOn')}</Label>
          <DateInput id="receipt-date" value={date} onChange={setDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-time">{t('receivedAt', { timeZone })}</Label>
          <Input
            id="receipt-time"
            type="time"
            dir="ltr"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        {members.length > 0 ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="receipt-receiver">{t('receivedBy')}</Label>
            <Select value={receiver} onValueChange={setReceiverId}>
              <SelectTrigger id="receipt-receiver">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {localized({ nameAr: m.fullNameAr, nameEn: m.fullNameEn })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('noPricesNote')}</p>
      {log.error ? <ErrorText>{apiError(log.error)}</ErrorText> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button
          disabled={!supplierId || !date || !time || !receiver || log.isPending}
          onClick={submit}
        >
          {t('log')}
        </Button>
      </div>
    </div>
  );
}

interface AttendeeRow {
  key: string;
  userId: string;
  externalName: string;
  function: string;
}

function OpeningDialog({
  event,
  open,
  onOpenChange,
}: {
  event: SourcingEventDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('sourcing.opening');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const members = useMembers();
  const me = useMe();
  const doOpen = useOpenRfq(event.id);
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<AttendeeRow[]>(() => [
    { key: 'me', userId: me.data?.user.id ?? '', externalName: '', function: '' },
    { key: 'second', userId: '', externalName: '', function: '' },
  ]);
  const late = event.offers.filter((o) => o.status === 'late');
  const [accept, setAccept] = useState<Record<string, string>>({});

  const patch = (key: string, change: Partial<AttendeeRow>) =>
    setAttendees((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const complete = attendees.filter(
    (a) => (a.userId || a.externalName.trim()) && a.function.trim()
  );

  const submit = () =>
    doOpen.mutate(
      {
        expectedVersion: event.version,
        place: place || null,
        notes: notes || null,
        attendees: complete.map((a) =>
          a.userId
            ? { userId: a.userId, function: a.function.trim() }
            : { externalName: a.externalName.trim(), function: a.function.trim() }
        ),
        acceptLate: Object.entries(accept)
          .filter(([, reason]) => reason.trim())
          .map(([offerId, reason]) => ({ offerId, reason: reason.trim() })),
      },
      { onSuccess: () => onOpenChange(false) }
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opening-place">{t('place')}</Label>
              <Input
                id="opening-place"
                dir="auto"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opening-notes">{t('notes')}</Label>
              <Input
                id="opening-notes"
                dir="auto"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('attendees')}</legend>
            {attendees.map((a, i) => (
              <div key={a.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                {members.length > 0 ? (
                  <Select
                    value={a.userId || '__external'}
                    onValueChange={(v) =>
                      patch(a.key, { userId: v === '__external' ? '' : v, externalName: '' })
                    }
                  >
                    <SelectTrigger aria-label={t('attendee', { n: i + 1 })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__external">{t('external')}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {localized({ nameAr: m.fullNameAr, nameEn: m.fullNameEn })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {!a.userId ? (
                  <Input
                    dir="auto"
                    aria-label={t('externalName', { n: i + 1 })}
                    placeholder={t('externalName', { n: i + 1 })}
                    value={a.externalName}
                    onChange={(e) => patch(a.key, { externalName: e.target.value })}
                  />
                ) : null}
                <div className="flex gap-2">
                  <Input
                    dir="auto"
                    aria-label={t('function', { n: i + 1 })}
                    placeholder={t('function', { n: i + 1 })}
                    value={a.function}
                    onChange={(e) => patch(a.key, { function: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('removeAttendee')}
                    onClick={() => setAttendees((rows) => rows.filter((r) => r.key !== a.key))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setAttendees((rows) => [
                  ...rows,
                  { key: crypto.randomUUID(), userId: '', externalName: '', function: '' },
                ])
              }
            >
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t('addAttendee')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('minimum', { count: 2 })}</p>
          </fieldset>

          {late.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="font-medium">{t('lateOffers')}</legend>
              <p className="text-xs text-muted-foreground">{t('lateIntro')}</p>
              {late.map((o) => (
                <div key={o.id} className="space-y-1">
                  <Label htmlFor={`late-${o.id}`}>
                    {localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn })}
                  </Label>
                  <Textarea
                    id={`late-${o.id}`}
                    dir="auto"
                    rows={2}
                    placeholder={t('lateReason')}
                    value={accept[o.id] ?? ''}
                    onChange={(e) => setAccept((cur) => ({ ...cur, [o.id]: e.target.value }))}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
        </div>
        {doOpen.error ? <ErrorText>{apiError(doOpen.error)}</ErrorText> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button disabled={complete.length < 2 || doOpen.isPending} onClick={submit}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiptsPanel({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.receipts');
  const to = useTranslations('sourcing.opening');
  const localized = useLocalizedName();
  const timeZone = useTenantTimeZone();
  const [logging, setLogging] = useState(false);
  const [opening, setOpening] = useState(false);
  const canLog = event.availableActions.includes('log_receipt');
  const canOpen = event.availableActions.includes('open');

  if (event.status === 'draft') return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {canLog && !logging ? (
            <Button variant="outline" onClick={() => setLogging(true)}>
              {t('add')}
            </Button>
          ) : null}
          {canOpen ? (
            <Button
              disabled={!event.deadlinePassed}
              title={event.deadlinePassed ? undefined : to('beforeDeadline')}
              onClick={() => setOpening(true)}
            >
              {to('open')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {canOpen && !event.deadlinePassed ? (
          <p className="text-sm text-muted-foreground">{to('beforeDeadline')}</p>
        ) : null}
        {logging ? <ReceiptForm event={event} onDone={() => setLogging(false)} /> : null}

        {event.opening ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {to('openedAt', { at: formatDateTime(event.opening.openedAt, timeZone) })}
              {event.opening.place ? ` Â· ${event.opening.place}` : ''}
            </p>
            <p className="text-muted-foreground">
              {event.opening.attendees.map((a) => `${a.name} (${a.function})`).join(' Â· ')}
            </p>
          </div>
        ) : null}
        {event.needsWaiverOrReissue ? (
          <p role="status" className="rounded-md border border-destructive/40 p-3 text-sm">
            {to('tooFew', {
              count: event.validOfferCount,
              required: event.method.requiredMinQuotations,
            })}
          </p>
        ) : null}

        {event.offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('supplier')}</TableHead>
                  <TableHead className="w-44">{t('receivedAtShort')}</TableHead>
                  <TableHead className="w-44">{t('receivedBy')}</TableHead>
                  <TableHead className="w-36">{t('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.offers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      {localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn })}
                    </TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {formatDateTime(o.receivedAt, timeZone)}
                    </TableCell>
                    <TableCell>{o.receivedByName}</TableCell>
                    <TableCell>
                      <Badge variant={TONE[o.status]}>{t(`statuses.${o.status}`)}</Badge>
                      {o.lateAcceptanceReason ? (
                        <span className="block text-xs text-muted-foreground">
                          {o.lateAcceptanceReason}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {opening ? <OpeningDialog event={event} open={opening} onOpenChange={setOpening} /> : null}
    </Card>
  );
}
