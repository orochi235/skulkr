import type { ReactNode } from 'react';
import { APP_NAME } from './title';
import s from './AppTitle.module.css';

/** The header's title: the app's name light, then, when there is one, the project it shows heavy. */
export function AppTitle({ project }: { project?: ReactNode }) {
  return (
    <span className={s.title}>
      <span className={s.app}>{APP_NAME}</span>
      {project !== undefined && (
        <>
          <span className={s.bullet} aria-hidden="true">⨯</span>
          <span className={s.project}>{project}</span>
        </>
      )}
    </span>
  );
}
