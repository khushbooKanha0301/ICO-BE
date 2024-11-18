import { HttpStatus, Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/users.service';

@Injectable()
export class EmailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  async generateEmailVerificationToken(email: string, userId: string): Promise<string> {
    try {
      const payload = { email , userId};
      const token = this.jwtService.sign(payload);
      return token;
    } catch (error) {
      throw new Error('Token generation failed');
    }
  }
  
  private compileTemplate(templateName: string, context: any): string {
    const templatePath = join(__dirname, '..', '../mails', `${templateName}.hbs`);
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateContent);
    return template(context);
  }

  async sendVerificationEmail(updateData: any,globalContext:any,mailSubject: string) {
    // Compile both HTML and plain text versions
    const htmlContent = this.compileTemplate('confirm-email', globalContext);
    const plainTextContent = this.compileTemplate('confirm-email-text', globalContext);
    try {
      await this.mailerService.sendMail({
        to: updateData?.email,
        subject: mailSubject,
        text: plainTextContent, // Plain text content
        html: htmlContent,       // HTML content
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}
