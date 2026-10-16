import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { IProbeResponse, ReadinessProbe, ProbeMethod, readinessPasses } from '@libs/backends';

import { Backoff } from '../common/backoff';
import { ConfigService } from '../config/config.service';

@Injectable()
export class ReadinessService implements OnModuleDestroy {
  private readonly logger = new Logger(ReadinessService.name);

  /** Instance key to the container that passed, so a replacement container is probed again rather than trusted. */
  private readonly passed = new Map<string, string>();
  private readonly watching = new Map<string, AbortController>();

  private readonly ready = new Subject<string>();

  constructor(private readonly configService: ConfigService) {}

  onModuleDestroy(): void {
    for (const instanceKey of [...this.watching.keys()]) {
      this.forget(instanceKey);
    }
  }

  /** The key of every instance whose probe has just passed. */
  changes(): Observable<string> {
    return this.ready.asObservable();
  }

  isReady(instanceKey: string, containerId: string): boolean {
    return this.passed.get(instanceKey) === containerId;
  }

  /** Watching a container already watched does nothing, so this can be called on every sweep. */
  watch(instanceKey: string, containerId: string, endpoint: string, probe: ReadinessProbe): void {
    if (this.watching.has(instanceKey) || this.isReady(instanceKey, containerId)) {
      return;
    }

    const controller = new AbortController();
    this.watching.set(instanceKey, controller);

    this.poll(instanceKey, containerId, endpoint, probe, controller.signal)
      .catch((error: unknown) => {
        this.logger.debug({ error, instanceKey }, 'watch(): A readiness watch ended on an error');
      })
      .finally(() => {
        if (this.watching.get(instanceKey) === controller) {
          this.watching.delete(instanceKey);
        }
      });
  }

  /** Aborts the watch, so a container replacing this one is proven again rather than inheriting its pass. */
  forget(instanceKey: string): void {
    this.watching.get(instanceKey)?.abort();
    this.watching.delete(instanceKey);
    this.passed.delete(instanceKey);
  }

  private async poll(
    instanceKey: string,
    containerId: string,
    endpoint: string,
    probe: ReadinessProbe,
    signal: AbortSignal
  ): Promise<void> {
    const backoff = new Backoff(this.configService.instanceProbeBackoff);

    while (!signal.aborted) {
      const response = await this.request(endpoint, probe, signal);

      if (response !== null && readinessPasses(probe, response)) {
        this.passed.set(instanceKey, containerId);
        this.ready.next(instanceKey);

        return;
      }

      await this.wait(backoff.next(), signal);
    }
  }

  /** Null where the backend refused the connection or answered nothing readable, which is not a pass. */
  private async request(endpoint: string, probe: ReadinessProbe, signal: AbortSignal): Promise<IProbeResponse | null> {
    const timeout = AbortSignal.timeout(this.configService.instanceProbeTimeoutMs);

    try {
      const response = await fetch(`${endpoint}${probe.path}`, {
        method: probe.method === ProbeMethod.POST ? 'POST' : 'GET',
        signal: AbortSignal.any([signal, timeout]),

        // A backend that answers with a redirect is not ready, and following one would take the agent elsewhere.
        redirect: 'manual',
      });

      return { status: response.status, body: await this.readBody(response) };
    } catch {
      return null;
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private wait(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>(resolve => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
