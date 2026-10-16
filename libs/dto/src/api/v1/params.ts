import { z } from 'zod';

import { INT4_MAX, wholeNumberParam } from '../../fields';

export const IdParamDto = wholeNumberParam(0, INT4_MAX);
export type IdParamDto = z.infer<typeof IdParamDto>;

export const PageParamDto = wholeNumberParam(1, INT4_MAX);
export type PageParamDto = z.infer<typeof PageParamDto>;
