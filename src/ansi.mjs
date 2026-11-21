/** `text` without its terminal color codes, as a runner's log carries them. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
export const stripAnsi = (text) => text.replace(ANSI, '');
