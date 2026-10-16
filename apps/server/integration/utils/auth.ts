export const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});
