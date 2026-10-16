import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Injectable, InternalServerErrorException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { lstatSync, readFileSync } from 'fs';
import Handlebars from 'handlebars';
import { omit } from 'lodash';
import { Transporter, createTransport } from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import SESTransport from 'nodemailer/lib/ses-transport';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { join } from 'path';

import { ConfigService } from '@/config/config.service';

interface IWelcomeValues {
  name: string;
  signInUrl: string;
}

type EmailTemplateValues = IWelcomeValues;

export enum EmailTemplate {
  WELCOME = 'welcome.handlebars',
}

const SENDER_NAME = 'Modelfleet';

const SMTP_CONNECT_TIMEOUT_MS = 5_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

@Injectable()
export class EmailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailService.name);

  private readonly handlebars = Handlebars.create();

  private readonly templates: { [key: string]: Handlebars.TemplateDelegate } = {};

  private transport: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    for (const emailTemplate of Object.values(EmailTemplate)) {
      const emailTemplateContent = this.readTemplate(emailTemplate);

      try {
        this.templates[emailTemplate] = this.handlebars.compile(emailTemplateContent);
      } catch (error) {
        this.logger.error({ error, emailTemplate }, 'onApplicationBootstrap(): Failed to compile email template');
        throw new InternalServerErrorException();
      }
    }

    if (this.configService.emailSmtpHost !== '') {
      const username = this.configService.emailSmtpUsername.trim();

      this.transport = createTransport(
        new SMTPTransport({
          host: this.configService.emailSmtpHost,
          port: this.configService.emailSmtpPort,
          // An empty username still makes nodemailer attempt AUTH, which a relay that advertises it refuses.
          auth: username !== '' ? { user: username, pass: this.configService.emailSmtpPassword } : undefined,
          secure: this.configService.emailSmtpSecure,
          requireTLS: this.configService.emailSmtpStarttls,
          connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
          greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
          socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        })
      );
    } else {
      const sesClient = new SESv2Client({
        region: this.configService.emailSesRegion,
        credentials:
          this.configService.emailSesAccessKeyId !== ''
            ? {
                accessKeyId: this.configService.emailSesAccessKeyId,
                secretAccessKey: this.configService.emailSesSecretAccessKey,
              }
            : undefined,
      });

      this.transport = createTransport(
        new SESTransport({
          SES: {
            sesClient,
            SendEmailCommand,
          },
        })
      );
    }
  }

  /** Never throws: a failed or skipped send is logged and returns false. */
  async sendEmail(toAddress: string, emailTemplate: EmailTemplate, values: EmailTemplateValues): Promise<boolean> {
    if (!this.transport) {
      this.logger.error({ emailTemplate }, 'sendEmail(): Skipping email as the transport is not available');
      return false;
    }

    try {
      const template = this.templates[emailTemplate];

      const message: Mail.Options = {
        from: { name: SENDER_NAME, address: this.configService.emailFromAddress },
        to: toAddress,
        subject: template({ subject: true, ...values }),
        text: template({ text: true, ...values }),
        html: template({ html: true, ...values }),
      };

      const response: unknown = await this.transport.sendMail(message);
      this.logger.log(
        { response: typeof response === 'object' ? omit(response, 'raw') : response },
        'sendEmail(): Successfully sent email'
      );

      return true;
    } catch (error) {
      this.logger.error({ error }, 'sendEmail(): Failed to send email');
    }

    return false;
  }

  private readTemplate(file: string): string {
    const templatePath = join(this.configService.emailTemplatesPath, file);

    try {
      if (lstatSync(templatePath).isFile()) {
        return readFileSync(templatePath).toString('utf-8');
      }
    } catch (error) {
      this.logger.error({ error, templatePath }, 'readTemplate(): Failed to read email template');
      throw new InternalServerErrorException();
    }

    this.logger.error({ templatePath }, 'readTemplate(): Email template is not a file');
    throw new InternalServerErrorException();
  }
}
