export interface ISignInCredentials {
  email: string;
  password: string;
}

// Seeded admin, created by apps/server/src/database/migrations/1596966611000-InitialDBEntries.ts.
export const TEST_USER: ISignInCredentials = {
  email: 'admin@modelfleet.test',
  password: 'changeme',
};

// Password given to users built by the user factory.
export const TEST_PASSWORD = 'TestPass123!';
