export enum EntryPoint {
  MANAGEMENT = 'management',
  GATEWAY = 'gateway',
}

/** A request as the listener it arrived on stamped it, before any middleware or guard reads it. */
export interface IEntryPointRequest {
  url?: string;
  entryPoint?: EntryPoint;
}
