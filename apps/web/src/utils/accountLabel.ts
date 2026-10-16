export const accountLabel = (name: string, email: string): string => (name.trim() !== '' ? name.trim() : email);

export const accountInitial = (name: string, email: string): string =>
  accountLabel(name, email).charAt(0).toUpperCase();
