import type { ReactNode } from 'react';
import { Button, DialogTrigger } from 'react-aria-components';
import { Icon } from '@weasel-js/ui/components/Icon';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import { icon } from '@dash/icons.gen';
import s from './AboutButton.module.css';

/** An ⓘ button that opens `children` beside it: what a chart or a section shows, kept out of the way until asked. */
export function AboutButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DialogTrigger>
      <Button className={s.about} aria-label={label}><Icon name={icon('ui:info')} size={14} /></Button>
      <Popover placement="bottom end" offset={6}>
        <PopoverDialog aria-label={label} className={s.aboutText}>{children}</PopoverDialog>
      </Popover>
    </DialogTrigger>
  );
}
