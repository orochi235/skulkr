/** The app's own name, which leads every title. */
export const APP_NAME = 'skulkr';

/** The document's title: the app, then the project it shows (`skulkr ⨯ myproject`), as astv names its windows. */
export const titleFor = (project: string | null): string => (project ? `${APP_NAME} ⨯ ${project}` : APP_NAME);
