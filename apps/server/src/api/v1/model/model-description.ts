import { ModelLicence } from '@libs/agent-protocol';
import { ModelLicenceDto, LicenceTerms } from '@libs/dto';

import { CUSTOM_LICENCE_ID, isNonCommercialLicence } from '@/core/model/licence';

export const getIModelLicence = (licence: ModelLicence | null): ModelLicenceDto | null => {
  if (licence === null) {
    return null;
  }

  let terms: LicenceTerms | null = null;

  if (isNonCommercialLicence(licence.id)) {
    terms = LicenceTerms.NON_COMMERCIAL;
  } else if (licence.id.toLowerCase() === CUSTOM_LICENCE_ID) {
    terms = LicenceTerms.CUSTOM;
  }

  return { id: licence.id, name: licence.name, link: licence.link, terms };
};
