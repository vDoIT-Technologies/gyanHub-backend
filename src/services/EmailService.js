import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { ENV } from '../configs/constant.js';

const __dirname = path.resolve();

const SES_CONFIG = {
    credentials: {
        accessKeyId: ENV.AWS_ACCESS_KEY,
        secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY
    },
    region: ENV.AWS_REGION
};

const sesClient = new SESClient(SES_CONFIG);

export class EmailService {
    /**
     * Sends a signup verification email to the user.
     * @param {string} to - Recipient email address.
     * @param {string} token - Verification token.
     * @param {string} origin - The origin URL for generating the verification link.
     * @param {string} name - Recipient's name.
     * @param {string} text - Additional text to include in the email.
     * @param {string} textBelow - Additional text to display below the main content.
     * @returns {object} - Success status of the email sending operation.
     */
    async sendSignUpEmail(to, token, origin, name, text, textBelow) {
        const domain = `${origin}?token=${token}`;

        const templatePath = path.join(__dirname, 'src', 'views', 'verify-email.ejs');

        const root = path.join(__dirname, 'views');
        const template = fs.readFileSync(templatePath, 'utf-8');
        const clientName = 'Twin-sentience';
        const supportEmail = 'support@twinSentience.com';

        const htmlContent = ejs.render(template, {
            root,
            domain,
            text,
            clientName,
            supportEmail,
            name,
            textBelow
        });
        const params = {
            Destination: {
                ToAddresses: [to]
            },
            Message: {
                Body: {
                    Html: {
                        Charset: 'UTF-8',
                        Data: htmlContent
                    },
                    Text: {
                        Data: `Hi ${name}! Please complete the verification process`
                    }
                },
                Subject: {
                    Data: 'Verification link'
                }
            },
            Source: ENV.AWS_SENDER
        };

        const sendEmailCommand = new SendEmailCommand(params);
        let response = await sesClient.send(sendEmailCommand);
        const res = response.$metadata.httpStatusCode;
        if (res === 200) {
            return { success: true };
        } else {
            return { success: false };
        }
    }

    /**
     * Sends a password reset email to the user.
     * @param {string} to - Recipient email address.
     * @param {string} token - Password reset token.
     * @param {string} origin - The origin URL for generating the reset link.
     * @param {string} name - Recipient's name.
     * @param {string} text - Additional text to include in the email.
     * @param {string} textBelow - Additional text to display below the main content.
     * @returns {object} - Success status of the email sending operation.
     */
    async sendResetEmail(to, token, origin, name, text, textBelow) {
        const domain = `${origin}?token=${token}`;

        const templatePath = path.join(__dirname, 'src', 'views', 'forgot-password.ejs');

        const root = path.join(__dirname, 'views');
        const template = fs.readFileSync(templatePath, 'utf-8');
        const clientName = 'Twin-sentience';
        const supportEmail = 'support@twinSentience.com';

        const htmlContent = ejs.render(template, {
            root,
            domain,
            text,
            clientName,
            supportEmail,
            name,
            textBelow
        });
        const params = {
            Destination: {
                ToAddresses: [to]
            },
            Message: {
                Body: {
                    Html: {
                        Charset: 'UTF-8',
                        Data: htmlContent
                    },
                    Text: {
                        Data: `Hi ${name}, You requested to reset your password.`
                    }
                },
                Subject: {
                    Data: 'Reset Your Passsword'
                }
            },
            Source: ENV.AWS_SENDER
        };

        const sendEmailCommand = new SendEmailCommand(params);
        let response = await sesClient.send(sendEmailCommand);
        const res = response.$metadata.httpStatusCode;
        if (res === 200) {
            return { success: true };
        } else {
            return { success: false };
        }
    }
}
