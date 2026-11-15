'use client';

import { PERMISSIONS, activityCreate, type Activity } from '@ngo/shared';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useActivities, useSaveActivity } from './api';
import { ErrorText, Field, apiFieldErrors, zodFieldErrors, type FieldErrors } from './shared';

function ActivityDialog({
  open,
  onOpenChange,
  grantId,
  activity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grantId: string;
  activity?: Activity;
}) {
  const t = useTranslations('activities');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveActivity(grantId);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setCode(activity?.code ?? '');
      setName(activity?.name ?? '');
      setIsActive(activity?.isActive ?? true);
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = activityCreate.safeParse({ code, name, isActive });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: activity?.id, body: parsed.data });
      onOpenChange(false);
    } catch (err) {
      setErrors(apiFieldErrors(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{activity ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <Field id="activity-code" label={t('code')} error={errors.code}>
            <Input
              id="activity-code"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field id="activity-name" label={t('name')} error={errors.name}>
            <Input id="activity-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="activity-active"
              checked={isActive}
              onCheckedChange={(v) => setIsActive(v === true)}
            />
            <Label htmlFor="activity-active">{t('active')}</Label>
          </div>
          {save.error && Object.keys(errors).length === 0 ? (
            <ErrorText>{apiError(save.error)}</ErrorText>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Optional activities of a grant (FR-011). */
export function ActivitiesTable({ grantId }: { grantId: string }) {
  const t = useTranslations('activities');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const can = useHasPermission();
  const canManage = can(PERMISSIONS.GRANTS_MANAGE);
  const { data, error, isPending } = useActivities(grantId);
  const [editing, setEditing] = useState<Activity | undefined>();
  const [open, setOpen] = useState(false);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !data) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const openDialog = (activity?: Activity) => {
    setEditing(activity);
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => openDialog()}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('code')}</TableHead>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('statusColumn')}</TableHead>
              {canManage ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell dir="ltr" className="text-start font-medium">
                    {a.code}
                  </TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>
                    <Badge variant={a.isActive ? 'default' : 'outline'}>
                      {a.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openDialog(a)}>
                        {t('edit')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <ActivityDialog open={open} onOpenChange={setOpen} grantId={grantId} activity={editing} />
    </div>
  );
}
