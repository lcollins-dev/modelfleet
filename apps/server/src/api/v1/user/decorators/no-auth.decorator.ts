import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const NO_AUTH_METADATA_KEY = 'no-auth';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const NoAuth = (): CustomDecorator => SetMetadata(NO_AUTH_METADATA_KEY, true);
