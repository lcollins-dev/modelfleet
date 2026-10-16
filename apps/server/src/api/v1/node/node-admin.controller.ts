import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  NodeDto,
  NodeListResponseDto,
  RegisterNodeResponseDto,
  UserRoleId,
  NodeListRequestDto,
  RegisterNodeRequestDto,
  UpdateNodeRequestDto,
  UpdateNodeStateRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { NodeAdminService } from './node-admin.service';

@Controller('api/v1/admin/node')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class NodeAdminController {
  constructor(private readonly nodeAdminService: NodeAdminService) {}

  @Patch('list')
  getNodeList(
    @Body(new ZodPipe(NodeListRequestDto)) nodeListRequest: NodeListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<NodeListResponseDto> {
    return this.nodeAdminService.getNodeList(nodeListRequest, page);
  }

  @Post()
  registerNode(
    @GetUser() user: User,
    @Body(new ZodPipe(RegisterNodeRequestDto)) registerNodeRequest: RegisterNodeRequestDto
  ): Promise<RegisterNodeResponseDto> {
    return this.nodeAdminService.registerNode(registerNodeRequest.name, registerNodeRequest.description ?? '', user.id);
  }

  @Get(':nodeId')
  getNode(@Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number): Promise<NodeDto> {
    return this.nodeAdminService.getNode(nodeId);
  }

  @Patch(':nodeId')
  updateNode(
    @GetUser() user: User,
    @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number,
    @Body(new ZodPipe(UpdateNodeRequestDto)) updateNodeRequest: UpdateNodeRequestDto
  ): Promise<void> {
    return this.nodeAdminService.updateNode(nodeId, updateNodeRequest.name, updateNodeRequest.description, user.id);
  }

  @Patch(':nodeId/state')
  updateState(
    @GetUser() user: User,
    @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number,
    @Body(new ZodPipe(UpdateNodeStateRequestDto)) updateNodeStateRequest: UpdateNodeStateRequestDto
  ): Promise<void> {
    return this.nodeAdminService.updateState(nodeId, updateNodeStateRequest.enabled, user.id);
  }

  @Delete(':nodeId')
  deleteNode(@GetUser() user: User, @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number): Promise<void> {
    return this.nodeAdminService.deleteNode(nodeId, user.id);
  }
}
