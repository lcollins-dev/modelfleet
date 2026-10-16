import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { User } from '@/core/user/entities/user.entity';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const GetUser = createParamDecorator((_data, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
  return req.user;
});
