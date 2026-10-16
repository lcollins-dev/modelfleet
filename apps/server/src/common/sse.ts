import { MessageEvent } from '@nestjs/common';
import { Observable, endWith, interval, map, merge, takeWhile } from 'rxjs';

/** A stream can sit still for hours, and a quiet connection is one an intermediary will close. */
const HEARTBEAT_MS = 5000;

/**
 * Nest omits the data line for an empty string, and a browser's event-stream parser never
 * dispatches an event whose data buffer is empty, so a beat without this is silently discarded.
 */
const HEARTBEAT_DATA = 'beat';

/** Marks the payloads' completion inside the merge, and is never sent. */
const PAYLOADS_ENDED: MessageEvent = { data: HEARTBEAT_DATA };

export interface IHeartbeatOptions {
  /** Ends the response once the payloads complete. Otherwise the beat holds it open until the client leaves. */
  endWithPayloads?: boolean;
}

/**
 * Every `@Sse()` route belongs behind this. A client watchdog remakes a connection that has gone
 * silent, so a stream that never beat would be torn down and reconnected for as long as it ran.
 */
export const withHeartbeat = (
  payloads: Observable<string | object>,
  options: IHeartbeatOptions = {}
): Observable<MessageEvent> => {
  const messages = payloads.pipe(map((data): MessageEvent => ({ data })));
  const beats = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: HEARTBEAT_DATA })));

  if (options.endWithPayloads !== true) {
    return merge(messages, beats);
  }

  return merge(messages.pipe(endWith(PAYLOADS_ENDED)), beats).pipe(takeWhile(message => message !== PAYLOADS_ENDED));
};
