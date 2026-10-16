import { Injectable, Logger } from '@nestjs/common';

export interface IInferenceMetric {
  deploymentId: number;
  deploymentName: string;
  apiKeyId: number;
  operation: string;
  streaming: boolean;
  instanceKey: string | null;
  status: number;

  /** Null where nothing was streamed, so a non-streaming answer records duration alone. */
  timeToFirstTokenMs: number | null;

  /** Null where an instance was ready when the request arrived. */
  loadWaitMs: number | null;

  durationMs: number;
}

@Injectable()
export class InferenceMetricsService {
  private readonly logger = new Logger(InferenceMetricsService.name);

  record(metric: IInferenceMetric): void {
    this.logger.log(metric, 'record(): An inference request finished');
  }
}
