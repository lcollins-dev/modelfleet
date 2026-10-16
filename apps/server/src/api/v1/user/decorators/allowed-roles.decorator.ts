import { SetMetadata, CustomDecorator } from '@nestjs/common';

import { UserRoleId } from '@libs/dto';

export const ALLOWED_ROLES_METADATA_KEY = 'allowed-roles';

/**
 * Set a list of allowed roles for the endpoint or controller
 * @param roles List of allowed roles
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const AllowedRoles = (...roles: UserRoleId[]): CustomDecorator => SetMetadata(ALLOWED_ROLES_METADATA_KEY, roles);
