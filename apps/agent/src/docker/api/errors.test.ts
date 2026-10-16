import { describe, expect, it } from 'vitest';

import { describeDockerError, DockerFault } from '@/docker/api/errors';

const refused = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const unreached = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

describe('describeDockerError', () => {
  it('calls a status the daemon answered with a refusal, since the request reached it', () => {
    const fault = describeDockerError(refused(409, 'Conflict. The container name is already in use'));

    expect(fault).toEqual({
      fault: DockerFault.REFUSED,
      message: 'Conflict. The container name is already in use',
      status: 409,
    });
  });

  it('calls an errno unreachable, since nothing answered', () => {
    expect(describeDockerError(unreached('ENOENT')).fault).toBe(DockerFault.UNREACHABLE);
    expect(describeDockerError(unreached('ECONNREFUSED')).fault).toBe(DockerFault.UNREACHABLE);
    expect(describeDockerError(unreached('EACCES')).fault).toBe(DockerFault.UNREACHABLE);
  });

  it('names the errno, so an operator knows whether to look at the socket or at its permissions', () => {
    expect(describeDockerError(unreached('EACCES')).message).toContain('EACCES');
  });

  it('treats an error carrying neither as a refusal, which is the one the operator can act on', () => {
    expect(describeDockerError(new Error('something else')).fault).toBe(DockerFault.REFUSED);
  });
});
