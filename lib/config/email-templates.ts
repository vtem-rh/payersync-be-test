export interface EmailTemplate {
  subject: string;
  body: string;
}

const addBaseTemplate = (emailBody: string): string => {
  return `
    <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PayerSync</title>
          <style>
            /* Reset styles for email compatibility */
            body, table, td, p, a, li, blockquote {
              -webkit-text-size-adjust: 100%;
              -ms-text-size-adjust: 100%;
            }

            table, td {
              mso-table-lspace: 0pt;
              mso-table-rspace: 0pt;
            }

            img {
              -ms-interpolation-mode: bicubic;
              border: 0;
              height: auto;
              line-height: 100%;
              outline: none;
              text-decoration: none;
            }

            /* Base styles */
            body {
              margin: 0;
              padding: 0;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 14px;
              line-height: 1.5;
              color: #212529;
              background-color: #f0f2f5;
            }

            /* Container styles */
            .email-container {
              width: 100%;
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              overflow: hidden;
            }

            .email-header {
              background-color: #f8f9fa;
              padding: 24px 32px;
              border-bottom: 1px solid #e0e0e0;
            }

            .email-body {
              padding: 32px;
              background-color: #ffffff;
            }

            .email-footer {
              background-color: #f8f9fa;
              padding: 24px 32px;
              border-top: 1px solid #e0e0e0;
              text-align: center;
              color: #717182;
            }

            /* Typography */
            h1 {
              font-size: 24px;
              font-weight: 500;
              line-height: 1.5;
              margin: 0 0 16px 0;
              color: #212529;
            }

            h2 {
              font-size: 20px;
              font-weight: 500;
              line-height: 1.5;
              margin: 0 0 16px 0;
              color: #212529;
            }

            h3 {
              font-size: 18px;
              font-weight: 500;
              line-height: 1.5;
              margin: 0 0 16px 0;
              color: #212529;
            }

            h4 {
              font-size: 16px;
              font-weight: 500;
              line-height: 1.5;
              margin: 0 0 16px 0;
              color: #212529;
            }

            p {
              font-size: 14px;
              font-weight: 400;
              line-height: 1.5;
              margin: 0 0 16px 0;
              color: #212529;
            }

            /* Button styles */
            .btn {
              display: inline-block;
              padding: 12px 24px;
              background-color: #030213;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              text-align: center;
              border: none;
              cursor: pointer;
            }

            .btn:hover {
              background-color: #1a1a2e;
            }

            /* Card styles */
            .card {
              background-color: #ffffff;
              border: 1px solid #e0e0e0;
              border-radius: 6px;
              padding: 16px;
              margin-bottom: 16px;
            }

            /* Divider */
            .divider {
              height: 1px;
              background-color: #e0e0e0;
              margin: 24px 0;
              border: none;
            }

            /* Responsive design */
            @media only screen and (max-width: 600px) {
              .email-container {
                width: 100% !important;
                max-width: 100% !important;
              }

              .email-header,
              .email-body,
              .email-footer {
                padding: 16px !important;
              }

              h1 {
                font-size: 20px !important;
              }

              h2 {
                font-size: 18px !important;
              }

              h3 {
                font-size: 16px !important;
              }
            }
          </style>
        </head>
        <body>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 48px 16px; background-color: #f0f2f5;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">
                  <!-- Header -->
                  <tr>
                    <td class="email-header">
                      <div style="width: 180px; height: 50px;">
                        <h2 style="padding-left: 25px; padding-top: 15px">PayerSync</h2>
                      </div>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td class="email-body">
                      ${emailBody}
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td class="email-footer">
                      <p style="margin: 0 0 8px 0; font-size: 14px; color: #717182;">
                        © 2025 Rectangle Health. All rights reserved.
                      </p>
                      <p style="margin: 0 0 8px 0; font-size: 12px; color: #717182;">
                        This is an automated message from PayerSync. Please do not reply to this email.
                      </p>
                      <p style="margin: 0; font-size: 12px; color: #717182;">
                        PayerSync, Inc. | 115 E Stevens Ave | Valhalla, NY 10595
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
  `;
};


export const cognitoEmailTemplates = {
  userVerification: {
    subject: 'Your PayerSync Verification Code',
    body: addBaseTemplate(`
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 32px 32px 16px 32px;">
            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Hello,<br />
            </p>

            <p style="font-size: 14px; font-weight: 800; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Here’s your verification code to continue:<br />
              {####}
            </p>

            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Use this code to verify your identity and continue setting up your PayerSync account or resetting your password.<br />
            </p>

            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              If you didn’t request this code, you can ignore this email.<br />
            </p>

            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 0 0; color: #4a4a4a;">
              Questions about your account? Contact us at <a href="mailto:hello@payersync.com">hello@payersync.com</a>
            </p>
          </td>
        </tr>
      </table>
    `),
  } as EmailTemplate,

  userInvitation: {
    subject: 'Your PayerSync Application Is Underway',
    body: addBaseTemplate(`
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 32px 32px 16px 32px;">
            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Hello {username},<br />
            </p>

            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Thanks for getting started with your PayerSync account.
            </p>

            <p style="font-size: 14px; font-weight: 800; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Your application has been successfully created. If you haven’t finished it yet, you can log in at any time to pick up where you left off.<br />
              {####}
            </p>

            <p style="font-size: 14px; font-weight: 400; line-height: 1.5; margin: 0 0 24px 0; color: #4a4a4a;">
              Questions? Call us at 1-888-992-0273 or send us an email at <a href="mailto:hello@payersync.com">hello@payersync.com</a>. We're here to help if you need any assistance along the way.<br />
            </p>
          </td>
        </tr>
      </table>
    `),
  } as EmailTemplate,
};
