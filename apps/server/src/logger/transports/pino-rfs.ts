import { omit } from 'lodash';
import { default as pretty } from 'pino-pretty';
import { createStream, Options as RfsOptions } from 'rotating-file-stream';

export interface IPinoRfsOptions extends RfsOptions {
  filename: string;
  pretty: boolean;
}

export default (options: IPinoRfsOptions) => {
  const rfsStream = createStream(options.filename, omit(options, ['filename', 'pretty']));

  if (options.pretty) {
    return pretty({
      colorize: false,
      destination: rfsStream,
    });
  }

  return rfsStream;
};
