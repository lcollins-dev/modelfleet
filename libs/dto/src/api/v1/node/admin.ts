import { z } from 'zod';

import { enumValue, flag, optionalText, requestBody, selection, text } from '../../../fields';
import { ListNodeDto, nodeName, NodeState } from './node';

export const RegisterNodeRequestDto = requestBody({
  name: nodeName(),
  description: text(0, 512, { trim: true }).optional(),
});
export type RegisterNodeRequestDto = z.infer<typeof RegisterNodeRequestDto>;

export const RegisterNodeResponseDto = z.object({
  id: z.number(),
  name: z.string(),
  nodeKey: z.string(),
  /** The only readable copy; the row keeps its hash alone. */
  secret: z.string(),
});
export type RegisterNodeResponseDto = z.infer<typeof RegisterNodeResponseDto>;

export const UpdateNodeRequestDto = requestBody({
  name: nodeName(),
  description: text(0, 512, { trim: true }),
});
export type UpdateNodeRequestDto = z.infer<typeof UpdateNodeRequestDto>;

export const UpdateNodeStateRequestDto = requestBody({
  enabled: flag(),
});
export type UpdateNodeStateRequestDto = z.infer<typeof UpdateNodeStateRequestDto>;

export const NodeListRequestDto = requestBody({
  search: optionalText(512),
  state: selection(enumValue(NodeState), 1, 4).optional(),
});
export type NodeListRequestDto = z.infer<typeof NodeListRequestDto>;

export const NodeListResponseDto = z.object({
  nodeList: z.array(ListNodeDto),
  pages: z.number(),
});
export type NodeListResponseDto = z.infer<typeof NodeListResponseDto>;
