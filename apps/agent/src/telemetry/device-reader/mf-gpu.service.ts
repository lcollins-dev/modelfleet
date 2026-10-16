import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

import { IReaderCommand, IReaderProcess } from './types/reader-process';

@Injectable()
export class MfGpuService {
  spawn(options: IReaderCommand): IReaderProcess {
    const child = spawn(options.command, ['--interval-seconds', String(options.intervalSeconds)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    return {
      onStdout: handler => child.stdout.on('data', handler),
      onStderr: handler => child.stderr.on('data', handler),
      onExit: handler => child.on('exit', handler),
      onError: handler => {
        child.on('error', handler);
        // A closed stdin raises on the stream, where an unhandled error event would end the process.
        child.stdin.on('error', handler);
      },
      request: () => {
        if (child.stdin.writable) {
          child.stdin.write('snapshot\n');
        }
      },
      kill: () => {
        child.kill('SIGTERM');
      },
    };
  }
}
