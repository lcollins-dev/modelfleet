import { Controller, Get } from '@nestjs/common';

import { DeploymentService } from '@/core/deployment/deployment.service';

import { GATEWAY_ROUTE_PREFIX } from '../../gateway-routes';
import { MODEL_LIST_OBJECT, MODEL_OBJECT, ModelList } from './model-list';

const MODEL_OWNER = 'modelfleet';

@Controller(`${GATEWAY_ROUTE_PREFIX}/models`)
export class ModelController {
  constructor(private readonly deploymentService: DeploymentService) {}

  /** Every deployment, resident or not, so a caller can discover a model before anything is running it. */
  @Get()
  async list(): Promise<ModelList> {
    const deployments = await this.deploymentService.findAll();

    return {
      object: MODEL_LIST_OBJECT,
      data: deployments.map(deployment => ({
        id: deployment.name,
        object: MODEL_OBJECT,
        created: Math.floor(deployment.createdDate.getTime() / 1000),
        owned_by: MODEL_OWNER,
      })),
    };
  }
}
