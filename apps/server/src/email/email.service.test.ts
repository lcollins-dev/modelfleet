import { SESv2Client } from '@aws-sdk/client-sesv2';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { lstatSync, readFileSync } from 'fs';
import { createTransport } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

vi.mock('fs', () => ({
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(),
  SendEmailCommand: vi.fn(),
}));

const TEMPLATE_SOURCE =
  '{{#if subject}}Welcome {{name}}{{/if}}{{#if text}}Hi {{name}}, sign in at {{signInUrl}}{{/if}}' +
  '{{#if html}}<p>Hi {{name}}</p>{{/if}}';

interface IConfigMock {
  emailTemplatesPath: string;
  emailFromAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpUsername: string;
  emailSmtpPassword: string;
  emailSmtpSecure: boolean;
  emailSmtpStarttls: boolean;
  emailSesRegion: string;
  emailSesAccessKeyId: string;
  emailSesSecretAccessKey: string;
}

const buildConfigMock = (overrides: Partial<IConfigMock> = {}): IConfigMock => ({
  emailTemplatesPath: '/srv/templates',
  emailFromAddress: 'no-reply@app.test',
  emailSmtpHost: 'smtp.test',
  emailSmtpPort: 587,
  emailSmtpUsername: 'smtp-user',
  emailSmtpPassword: 'smtp-pass',
  emailSmtpSecure: false,
  emailSmtpStarttls: true,
  emailSesRegion: 'eu-west-1',
  emailSesAccessKeyId: '',
  emailSesSecretAccessKey: '',
  ...overrides,
});

const buildService = async (config: IConfigMock): Promise<EmailService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [EmailService, { provide: ConfigService, useValue: config }],
  }).compile();

  return moduleRef.get(EmailService);
};

describe('EmailService', () => {
  let sendMailMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(lstatSync)
      .mockReset()
      .mockReturnValue({ isFile: () => true } as ReturnType<typeof lstatSync>);
    vi.mocked(readFileSync).mockReset().mockReturnValue(Buffer.from(TEMPLATE_SOURCE));
    vi.mocked(SESv2Client).mockClear();

    sendMailMock = vi.fn().mockResolvedValue({ messageId: 'abc' });
    vi.mocked(createTransport)
      .mockReset()
      .mockReturnValue({ sendMail: sendMailMock } as unknown as ReturnType<typeof createTransport>);
  });

  describe('onApplicationBootstrap', () => {
    it('reads every template from the configured directory', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      expect(lstatSync).toHaveBeenCalledWith(`/srv/templates/${EmailTemplate.WELCOME}`);
    });

    it('throws when a template path is not a file', async () => {
      vi.mocked(lstatSync).mockReturnValue({ isFile: () => false } as ReturnType<typeof lstatSync>);

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
    });

    it('logs and throws when a template is missing', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.mocked(lstatSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ templatePath: `/srv/templates/${EmailTemplate.WELCOME}` }),
        'readTemplate(): Failed to read email template'
      );

      errorSpy.mockRestore();
    });

    it('throws when a template cannot be read', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES');
      });

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
    });

    it('builds an smtp transport when an smtp host is configured', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      expect(vi.mocked(createTransport).mock.calls[0][0]).toBeInstanceOf(SMTPTransport);
    });

    it('authenticates with the configured username, and gives up on an unresponsive server within seconds', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      const { options } = vi.mocked(createTransport).mock.calls[0][0] as SMTPTransport;

      expect(options.auth).toEqual({ user: 'smtp-user', pass: 'smtp-pass' });
      expect(options.connectionTimeout).toBeLessThanOrEqual(10_000);
      expect(options.greetingTimeout).toBeLessThanOrEqual(10_000);
      expect(options.socketTimeout).toBeLessThanOrEqual(10_000);
    });

    it('sends no credentials when no username is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpUsername: ' ', emailSmtpPassword: '' }));

      service.onApplicationBootstrap();

      const { options } = vi.mocked(createTransport).mock.calls[0][0] as SMTPTransport;

      expect(options.auth).toBeUndefined();
    });

    it('falls back to an ses transport when no smtp host is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpHost: '' }));

      service.onApplicationBootstrap();

      expect(vi.mocked(createTransport).mock.calls[0][0]).not.toBeInstanceOf(SMTPTransport);
      expect(SESv2Client).toHaveBeenCalledWith({ region: 'eu-west-1', credentials: undefined });
    });

    it('leaves ses to the ambient credentials when no access key is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpHost: '' }));

      service.onApplicationBootstrap();

      expect(vi.mocked(SESv2Client).mock.calls[0][0]!.credentials).toBeUndefined();
    });

    it('passes the configured ses credentials through to the client', async () => {
      const service = await buildService(
        buildConfigMock({ emailSmtpHost: '', emailSesAccessKeyId: 'key-id', emailSesSecretAccessKey: 'secret' })
      );

      service.onApplicationBootstrap();

      expect(vi.mocked(SESv2Client).mock.calls[0][0]!.credentials).toEqual({
        accessKeyId: 'key-id',
        secretAccessKey: 'secret',
      });
    });
  });

  describe('sendEmail', () => {
    it('reports failure rather than throwing when the transport has not been built', async () => {
      const service = await buildService(buildConfigMock());

      const sent = await service.sendEmail('user@example.com', EmailTemplate.WELCOME, {
        name: 'Tester',
        signInUrl: 'https://app.test',
      });

      expect(sent).toBe(false);
    });

    it('renders the subject, text and html parts from the one template', async () => {
      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      await service.sendEmail('user@example.com', EmailTemplate.WELCOME, {
        name: 'Tester',
        signInUrl: 'https://app.test',
      });

      expect(sendMailMock).toHaveBeenCalledWith({
        from: { name: 'Modelfleet', address: 'no-reply@app.test' },
        to: 'user@example.com',
        subject: 'Welcome Tester',
        text: 'Hi Tester, sign in at https://app.test',
        html: '<p>Hi Tester</p>',
      });
    });

    it('reports success when the transport accepts the message', async () => {
      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      const sent = await service.sendEmail('user@example.com', EmailTemplate.WELCOME, {
        name: 'Tester',
        signInUrl: 'https://app.test',
      });

      expect(sent).toBe(true);
    });

    it('reports failure rather than throwing when the transport rejects', async () => {
      sendMailMock.mockRejectedValue(new Error('connection refused'));

      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      const sent = await service.sendEmail('user@example.com', EmailTemplate.WELCOME, {
        name: 'Tester',
        signInUrl: 'https://app.test',
      });

      expect(sent).toBe(false);
    });
  });
});
