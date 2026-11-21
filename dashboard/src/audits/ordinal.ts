/** `n` as an English ordinal: 1st, 2nd, 3rd, 11th, 22nd. */
export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
