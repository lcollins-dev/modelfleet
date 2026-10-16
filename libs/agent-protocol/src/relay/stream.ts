export const EVENT_STREAM_TYPE = 'text/event-stream';

export function asksForStream(accept: string): boolean {
  return accept.toLowerCase().includes(EVENT_STREAM_TYPE);
}
