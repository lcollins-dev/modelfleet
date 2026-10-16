export type FrameData = string | Buffer | ArrayBuffer | Buffer[];

export function readFrame(data: FrameData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
}
