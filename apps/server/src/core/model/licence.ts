export const CUSTOM_LICENCE_ID = 'other';

const NON_COMMERCIAL_PREFIX = 'cc-by-nc';

const NON_COMMERCIAL_LICENCES: readonly string[] = [
  'fair-noncommercial-research-license',
  'apple-amlr',
  'deepfloyd-if-license',
  'c-uda',
  'intel-research',
];

export const isNonCommercialLicence = (id: string): boolean => {
  const normalised = id.toLowerCase();

  return normalised.startsWith(NON_COMMERCIAL_PREFIX) || NON_COMMERCIAL_LICENCES.includes(normalised);
};
