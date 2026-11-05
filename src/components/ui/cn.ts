/** Joins class names, skipping empty ones. */
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
