import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Put,
  Res,
  Req,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from "@nestjs/common";
import { CreateUserDto } from "src/dto/create-users.dto";
import { UpdateUserProfileDto } from "src/dto/update-users-profile.dto";
import { UserService } from "src/service/user/users.service";
import { EmailService } from "src/service/email/email.service";
import { TokenService } from "src/service/token/token.service";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { Express } from "express";
import { ConfigService } from "@nestjs/config";
import { UpdateAccountSettingsDto } from "src/dto/update-account-settings.dto";
import { UpdateKycDataDto } from "src/dto/update-kyc.dto";
import { SkipThrottle } from "@nestjs/throttler";
import { MailerService } from "@nestjs-modules/mailer";
import moment from "moment";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { IUser } from "src/interface/users.interface";
const crypto = require('crypto');
const rp = require("request-promise-native");
const speakeasy = require("speakeasy");
const jwt = require("jsonwebtoken");
const Web3 = require("web3");
const web3 = new Web3("https://cloudflare-eth.com/");

const getSignMessage = (address, nonce) => {
  return `Please sign this message for address ${address}:\n\n${nonce}`;
};

// Ensure the secret key is 32 bytes long
const secretKey = crypto.createHash('sha256').update('your-secret-key').digest('base64').substr(0, 32);
const iv = crypto.randomBytes(16); // Initialization vector

function encryptEmail(email) {
  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey), iv);
    let encrypted = cipher.update(email, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted; // Combine IV with encrypted email
  } catch (error) {
    console.error("Encryption error:", error);
    return null;
  }
}

@SkipThrottle()
@Controller("users")
export class UsersController {
  constructor(
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
    @InjectModel("user") private usersModel: Model<IUser>
  ) {}

  /**
   * This API endpoint verifies the authenticity of a user's identity based on the provided signature.
   * @param req
   * @param response
   * @param body
   * @param query
   * @returns
   */
  @SkipThrottle(false)
  @Post("/verify")
  async verify(
    @Req() req: any,
    @Res() response,
    @Body() body: { walletType: string; referredBy?: string },
    @Query() query: { signatureId: string }
  ) {
    try {
      const jwtSecret = this.configService.get("jwt_secret");
      const authHeader = req.headers["authorization"];
      const tempToken = authHeader && authHeader.split(" ")[1];
      if (tempToken === null) return response.sendStatus(403);
      const userData = req.body.authData;
      const nonce = userData.nonce;
      const address = userData?.address
        ? userData?.address
        : userData?.verifiedAddress;
      const message = getSignMessage(address, nonce);
      const signature = query.signatureId;
      const walletType = body.walletType;
      const referredBy = body.referredBy ? body.referredBy : null;
      const s3 = this.configService.get("s3");
      const bucketName = this.configService.get("aws_s3_bucket_name");
      const file = null;
      let imageUrl = null;
      const verifiedAddress = await web3.eth.accounts.recover(
        message,
        signature
      );

      if (verifiedAddress.toLowerCase() == address.toLowerCase()) {
        let addressByUser = await this.userService.getFindbyAddress(address);
        if (addressByUser?.status === "Suspend") {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: "Can't Login, You are Suspended by Admin." });
        }
        let userInfo;
        const token = await jwt.sign({ verifiedAddress, nonce }, jwtSecret, {
          expiresIn: "1w",
        });
        let newToken = await this.tokenService.createToken({ token });
        let lastLogin = moment.utc(nonce).format();
        if (addressByUser) {
          let is_2FA_login_verified = true;
          if (addressByUser.is_2FA_enabled) {
            is_2FA_login_verified = false;
          }
          let UpdateUserProfileDto: any = {
            nonce: nonce,
            _token: token,
            last_login: lastLogin,
            is_2FA_login_verified,
          };
          if (addressByUser.profile && addressByUser.profile !== "") {
            const myKey = addressByUser.profile;

            imageUrl = s3.getSignedUrl("getObject", {
              Bucket: bucketName,
              Key: myKey,
            });
          }

          userInfo = await this.userService.updateUser(
            addressByUser._id,
            UpdateUserProfileDto,
            file,
            bucketName
          );
        } else {
          let createUserDto: any = {
            wallet_address: address,
            nonce: nonce,
            _token: token,
            wallet_type: walletType,
            referred_by: referredBy,
            last_login: lastLogin,
            created_at: lastLogin,
            is_2FA_login_verified: true,
          };
          imageUrl = null;
          userInfo = await this.userService.createUser(createUserDto);
        }
        userInfo.google_auth_secret = undefined;
        return response.status(HttpStatus.OK).json({
          token: token,
          user_id: userInfo._id,
          imageUrl: imageUrl ? imageUrl : null,
        });
      } else {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({ message: "user not valid." });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   * This API endpoint creates a new user based on the provided user data.
   * @param response
   * @param createUserDto
   * @returns
   */
  @Post()
  async createUsers(@Res() response, @Body() createUserDto: CreateUserDto) {
    try {
      const newUser = await this.userService.createUser(createUserDto);
      return response.status(HttpStatus.CREATED).json({
        message: "User has been created successfully",
        newUser,
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: "Error: User not created!",
        error: "Bad Request",
      });
    }
  }

  /**
   * This API endpoint updates user profile information including profile picture.
   * @param req
   * @param response
   * @param updateUsersDto
   * @param file
   * @returns
   */
  @Put()
  @UseInterceptors(FileInterceptor("profile"))
  async updateUsers(
    @Req() req: any,
    @Res() response,
    @Body() updateUsersDto: UpdateUserProfileDto,
    @UploadedFile() file: Express.Multer.File
  ) {
    try {
      if (file) {
        // Array of allowed files
        const array_of_allowed_files = ["png", "jpeg", "jpg", "gif"];
        const array_of_allowed_file_types = [
          "image/png",
          "image/jpeg",
          "image/jpg",
          "image/gif",
        ];
        // Allowed file size in mb
        const allowed_file_size = 2;
        // Get the extension of the uploaded file
        const file_extension = file.originalname.slice(
          ((file.originalname.lastIndexOf(".") - 1) >>> 0) + 2
        );

        // Check if the uploaded file is allowed
        if (
          !array_of_allowed_files.includes(file_extension) ||
          !array_of_allowed_file_types.includes(file.mimetype)
        ) {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: "Inappropriate file type" });
        }

        if (file.size / (1024 * 1024) > allowed_file_size || file.size < 1) {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: "File size should come between 1 Byte to 2 MB" });
        }
      }
      const pattern = /^[a-zA-Z0-9]*$/;

      if (
        !updateUsersDto.fname_alias.match(pattern) ||
        updateUsersDto.fname_alias.length > 20 ||
        !updateUsersDto.lname_alias.match(pattern) ||
        updateUsersDto.lname_alias.length > 20
      ) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Please enter valid name.",
        });
      }

      if (updateUsersDto.bio && updateUsersDto.bio.length > 80) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Bio should not exceed 80 characters.",
        });
      }

      if (typeof updateUsersDto.profile == "string") {
        delete updateUsersDto.profile;
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Something wrong with profile image.",
        });
      }
      let userDetails = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      const UserId = userDetails._id.toString();
      const bucketName = "middnapp";

      await this.userService.updateUser(
        UserId,
        updateUsersDto,
        file,
        bucketName
      );
      return response.status(HttpStatus.OK).json({
        message: "Users has been successfully updated.",
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   * This method handles the updating of KYC (Know Your Customer) information for a user.
   * It receives the updated KYC data, including personal information and document uploads,
   * validates the data, and updates the user's KYC information in the database.
   * @param response
   * @param updateKycDto
   * @param req
   * @param files
   * @returns
   */
  @SkipThrottle(false)
  @Put("/updateKyc")
  @UseInterceptors(AnyFilesInterceptor())
  async updateKyc(
    @Res() response,
    @Body() updateKycDto: UpdateKycDataDto,
    @Req() req: any,
    @UploadedFiles() files?: Array<Express.Multer.File>
  ) {
    try {
      let reqError = null;

      updateKycDto.fname = updateKycDto.fname.trim();
      updateKycDto.lname = updateKycDto.lname.trim();
      updateKycDto.res_address = updateKycDto.res_address.trim();
      updateKycDto.postal_code = updateKycDto.postal_code.trim();
      updateKycDto.city = updateKycDto.city.trim();

      if (!updateKycDto.fname) {
        reqError = "First name is missing";
      } else if (!updateKycDto.lname) {
        reqError = "Last name is missing";
      } else if (!updateKycDto.res_address) {
        reqError = "Residential address is missing";
      } else if (!updateKycDto.city) {
        reqError = "City is missing";
      } else if (!updateKycDto.postal_code) {
        reqError = "Postal code is missing";
      } else if (!updateKycDto.country_of_issue) {
        reqError = "Country of issue is missing";
      } else if (!updateKycDto.verified_with) {
        reqError = "Verified with is missing";
      } else if (!updateKycDto.dob) {
        reqError = "Date of Birth is missing";
      }
      if (!files || files.length < 2) {
        reqError = "Files are missing";
      } else {
        let userPhotoExists = false;
        let passportPhotoExists = false;

        for (let i = 0; i < files.length; i++) {
          if (files[i]["fieldname"] === "user_photo_url") {
            userPhotoExists = true;
          }
          if (files[i]["fieldname"] === "passport_url") {
            passportPhotoExists = true;
          }
        }
        if (!userPhotoExists) {
          reqError = "User photo is missing";
        }
        if (!passportPhotoExists) {
          reqError = "Passport photo is missing";
        }
      }
      const pattern = /^[a-zA-Z0-9]*$/;
      if (!updateKycDto.postal_code.match(pattern)) {
        reqError = "Postal code not valid";
      }
      if (reqError) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: reqError,
        });
      }
      let userDetails = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      if (userDetails.kyc_completed === true && userDetails.is_verified !== 2) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "KYC is already submitted.",
        });
      }
      let passport_url = {};
      let user_photo_url = {};
      if (files) {
        files?.map((file) => {
          if (file.fieldname === "passport_url") {
            passport_url = file;
          }
          if (file.fieldname === "user_photo_url") {
            user_photo_url = file;
          }
        });
      }
      const UserId = userDetails._id.toString();
      if (
        userDetails.fname &&
        (userDetails.fname != "" || userDetails.fname != null)
      ) {
        delete updateKycDto.fname;
      }
      if (
        userDetails.lname &&
        (userDetails.lname != "" || userDetails.lname != null)
      ) {
        delete updateKycDto.lname;
      }
      if (
        userDetails.mname &&
        (userDetails.mname != "" || userDetails.mname != null)
      ) {
        delete updateKycDto.mname;
      }
      if (
        userDetails.dob &&
        (userDetails.dob != "" || userDetails.dob != null)
      ) {
        delete updateKycDto.dob;
      }
      if (updateKycDto.is_verified) {
        delete updateKycDto.is_verified;
      }
      if (updateKycDto.wallet_address) {
        delete updateKycDto.wallet_address;
      }
      if (
        userDetails.city &&
        (userDetails.city != "" || userDetails.city != null)
      ) {
        delete updateKycDto.city;
      }

      if (updateKycDto.dob) {
        if (!moment(updateKycDto.dob, "DD/MM/YYYY", true).isValid()) {
          return response.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid Date Of Birth.",
          });
        }

        const currentDate = moment();
        const parsedGivenDate = moment(updateKycDto.dob, "DD/MM/YYYY");
        if (parsedGivenDate.isAfter(currentDate)) {
          return response.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid Date Of Birth.",
          });
        }
      }

      await this.userService.updateKyc(
        UserId,
        updateKycDto,
        passport_url,
        user_photo_url
      );
      const updateData = await this.userService.getUser(UserId);

      if (updateData && updateData?.email && updateData?.email_verified) {
        const globalContext = {
          formattedDate: moment().format("dddd, MMMM D, YYYY"),
          greeting: `Hello ${updateData?.fname
            ? updateData?.fname + " " + updateData?.lname
            : "John Doe"}`,
          para1: "Thank you for submitting your verification request. We've received your submitted document and other information for identity verification.",
          para2: "We'll review your information and if all is in order will approve your identity. If the information is incorrect or something missing, we will request this as soon as possible.",
          title: "KYC Submitted Email"
        };
        const mailSubject = `[Middn.io] :: Document Submitted for Identity Verification - https://ico.middn.com/`;
        const isVerified = await this.emailService.sendVerificationEmail(
          updateData,
          globalContext,
          mailSubject
        );

        if (isVerified) {
          return response.status(HttpStatus.OK).json({
            message: "Users has been successfully updated.",
          });
        } else {
          return response.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid or expired verification token.",
          });
        }
      } else {
        return response.status(HttpStatus.OK).json({
          message: "Users has been successfully updated.",
        });
      }
    } catch (error) {
      return response.status(HttpStatus.BAD_REQUEST).json(error.response);
    }
  }

  /**
   * This method validates the file type and size of an uploaded file.
   * It checks if the uploaded file has a valid file extension and size,
   * and returns an appropriate response message accordingly.
   * @param response
   * @param file
   * @returns
   */
  @Post("/validate-file-type")
  @UseInterceptors(AnyFilesInterceptor())
  async validateFileType(
    @Res() response,
    @UploadedFiles() file: Express.Multer.File
  ) {
    try {
      // Array of allowed files
      const array_of_allowed_files = ["jpg", "jpeg", "png"];
      // Allowed file size in mb
      const allowed_file_size = 5;
      // Get the extension of the uploaded file
      if (file) {
        const file_extension = file[0].originalname.slice(
          ((file[0].originalname.lastIndexOf(".") - 1) >>> 0) + 2
        );
        // Check if the uploaded file is allowed
        if (!array_of_allowed_files.includes(file_extension)) {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: "Please upload Valid Image" });
        }
        if (
          file[0].size / (1024 * 1024) > allowed_file_size ||
          file[0].size < 10240
        ) {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({
              message: "File size should come between 10 KB to 5120 KB",
            });
        }
        return response
          .status(HttpStatus.OK)
          .json({ message: "File uploaded successfully." });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   * * This method updates the account settings of a user.
   * @param req
   * @param response
   * @param updateAccountSettingDto
   * @returns
   */
  @SkipThrottle(false)
  @Put("/updateAccountSettings")
  async updateAccountSettings(
    @Req() req: any,
    @Res() response,
    @Body() updateAccountSettingDto: UpdateAccountSettingsDto
  ) {
    try {
      let userDetails = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      const UserId = userDetails._id.toString();
     
      updateAccountSettingDto.fname = updateAccountSettingDto.fname.trim();
      updateAccountSettingDto.lname = updateAccountSettingDto.lname.trim();
      updateAccountSettingDto.email = updateAccountSettingDto.email.trim();
      updateAccountSettingDto.phone = updateAccountSettingDto.phone.trim();
      updateAccountSettingDto.city = updateAccountSettingDto.city.trim();
      if (!updateAccountSettingDto.fname) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "First Name is missing.",
        });
      }
     
      if (!updateAccountSettingDto.lname) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Last Name is missing.",
        });
      }
     
      if (!updateAccountSettingDto.email) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Email is missing.",
        });
      }
     
      if (!updateAccountSettingDto.phone) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Phone is missing.",
        });
      }
      if (!updateAccountSettingDto.city) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "City is missing.",
        });
      }
      if (!updateAccountSettingDto.phoneCountry) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Phone Country is missing.",
        });
      }
      if (!updateAccountSettingDto.dob) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Date of Birth is missing.",
        });
      }
      if (
        userDetails.fname &&
        (userDetails.fname != "" || userDetails.fname != null)
      ) {
        delete updateAccountSettingDto.fname;
      }
      if (
        userDetails.lname &&
        (userDetails.lname != "" || userDetails.lname != null)
      ) {
        delete updateAccountSettingDto.lname;
      }
      if (
        userDetails.location &&
        (userDetails.location != "" || userDetails.location != null)
      ) {
        delete updateAccountSettingDto.location;
      }

      if (
        userDetails.dob &&
        (userDetails.dob != "" || userDetails.dob != null)
      ) {
        delete updateAccountSettingDto.dob;
      }

      if (
        updateAccountSettingDto.phone &&
        !updateAccountSettingDto.phone.match("^[0-9]{5,10}$")
      ) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Invalid Phone.",
        });
      }
     
      const countries = [
        "AF",
        "AL",
        "DZ",
        "AS",
        "AD",
        "AO",
        "AI",
        "AQ",
        "AG",
        "AR",
        "AM",
        "AW",
        "AU",
        "AT",
        "AZ",
        "BS",
        "BH",
        "BD",
        "BB",
        "BY",
        "BE",
        "BZ",
        "BJ",
        "BM",
        "BT",
        "BO",
        "BA",
        "BW",
        "BR",
        "IO",
        "VG",
        "BN",
        "BG",
        "BF",
        "BI",
        "KH",
        "CM",
        "CA",
        "CV",
        "KY",
        "CF",
        "TD",
        "CL",
        "CN",
        "CX",
        "CC",
        "CO",
        "KM",
        "CK",
        "CR",
        "HR",
        "CU",
        "CW",
        "CY",
        "CZ",
        "CD",
        "DK",
        "DJ",
        "DM",
        "DO",
        "TL",
        "EC",
        "EG",
        "SV",
        "GQ",
        "ER",
        "EE",
        "ET",
        "FK",
        "FO",
        "FJ",
        "FI",
        "FR",
        "PF",
        "GA",
        "GM",
        "GE",
        "DE",
        "GH",
        "GI",
        "GR",
        "GL",
        "GD",
        "GU",
        "GT",
        "GG",
        "GN",
        "GW",
        "GY",
        "HT",
        "HN",
        "HK",
        "HU",
        "IS",
        "IN",
        "ID",
        "IR",
        "IQ",
        "IE",
        "IM",
        "IL",
        "IT",
        "CI",
        "JM",
        "JP",
        "JE",
        "JO",
        "KZ",
        "KE",
        "KI",
        "XK",
        "KW",
        "KG",
        "LA",
        "LV",
        "LB",
        "LS",
        "LR",
        "LY",
        "LI",
        "LT",
        "LU",
        "MO",
        "MK",
        "MG",
        "MW",
        "MY",
        "MV",
        "ML",
        "MT",
        "MH",
        "MR",
        "MU",
        "YT",
        "MX",
        "FM",
        "MD",
        "MC",
        "MN",
        "ME",
        "MS",
        "MA",
        "MZ",
        "MM",
        "NA",
        "NR",
        "NP",
        "NL",
        "AN",
        "NC",
        "NZ",
        "NI",
        "NE",
        "NG",
        "NU",
        "KP",
        "MP",
        "NO",
        "OM",
        "PK",
        "PW",
        "PS",
        "PA",
        "PG",
        "PY",
        "PE",
        "PH",
        "PN",
        "PL",
        "PT",
        "PR",
        "QA",
        "CG",
        "RE",
        "RO",
        "RU",
        "RW",
        "BL",
        "SH",
        "KN",
        "LC",
        "MF",
        "PM",
        "VC",
        "WS",
        "SM",
        "ST",
        "SA",
        "SN",
        "RS",
        "SC",
        "SL",
        "SG",
        "SX",
        "SK",
        "SI",
        "SB",
        "SO",
        "ZA",
        "KR",
        "SS",
        "ES",
        "LK",
        "SD",
        "SR",
        "SJ",
        "SZ",
        "SE",
        "CH",
        "SY",
        "TW",
        "TJ",
        "TZ",
        "TH",
        "TG",
        "TK",
        "TO",
        "TT",
        "TN",
        "TR",
        "TM",
        "TC",
        "TV",
        "VI",
        "UG",
        "UA",
        "AE",
        "GB",
        "US",
        "UY",
        "UZ",
        "VU",
        "VA",
        "VE",
        "VN",
        "WF",
        "EH",
        "YE",
        "ZM",
        "ZW",
      ];
      if (
        updateAccountSettingDto.location &&
        !countries.includes(updateAccountSettingDto.location)
      ) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Invalid country name.",
        });
      }
      
      let validRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
      if (
        updateAccountSettingDto.email &&
        !updateAccountSettingDto.email.match(validRegex)
      ) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Invalid E-mail address.",
        });
      }
      
      if (updateAccountSettingDto.email) {
        try {
          // Check if the email already exists in the system
          const userEmail = await this.userService.getFindbyEmail(updateAccountSettingDto.email);
          
          // Safely check if userEmail exists before accessing its properties
          if (userEmail && userEmail._id && userEmail._id.toString() !== UserId) {
            return response.status(HttpStatus.BAD_REQUEST).json({
              message: "Email already exists.",
            });
          }
      
          // Check if the email is being updated and is verified
          const userEmailCheck = await this.userService.getFindbyId(UserId);
         
          // If the email is verified and the user is trying to change it
          if (userEmailCheck && userEmailCheck.email_verified && userEmailCheck.email !== updateAccountSettingDto.email) {
            return response.status(HttpStatus.BAD_REQUEST).json({
              message: "Your email address is already verified and cannot be changed.",
            });
          }
      
        } catch (error) {
          console.error("Error while checking email existence: ", error);
          return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: "An error occurred while processing the request.",
          });
        }
      }
      
     
      const countryCode = [
        "+93",
        "+355",
        "+213",
        "+1-684",
        "+376",
        "+244",
        "+1-264",
        "+672",
        "+1-268",
        "+54",
        "+374",
        "+297",
        "+61",
        "+43",
        "+994",
        "+1-242",
        "+973",
        "+880",
        "+1-246",
        "+375",
        "+32",
        "+501",
        "+229",
        "+1-441",
        "+975",
        "+591",
        "+387",
        "+267",
        "+55",
        "+246",
        "+1-284",
        "+673",
        "+359",
        "+226",
        "+257",
        "+855",
        "+237",
        "+1",
        "+238",
        "+1-345",
        "+236",
        "+235",
        "+56",
        "+86",
        "+61",
        "+61",
        "+57",
        "+269",
        "+682",
        "+506",
        "+385",
        "+53",
        "+599",
        "+357",
        "+420",
        "+243",
        "+45",
        "+253",
        "+1-767",
        "+1-809, 1-829, 1-849",
        "+670",
        "+593",
        "+20",
        "+503",
        "+240",
        "+291",
        "+372",
        "+251",
        "+500",
        "+298",
        "+679",
        "+358",
        "+33",
        "+689",
        "+241",
        "+220",
        "+995",
        "+49",
        "+233",
        "+350",
        "+30",
        "+299",
        "+1-473",
        "+1-671",
        "+502",
        "+44-1481",
        "+224",
        "+245",
        "+592",
        "+509",
        "+504",
        "+852",
        "+36",
        "+354",
        "+91",
        "+62",
        "+98",
        "+964",
        "+353",
        "+44-1624",
        "+972",
        "+39",
        "+225",
        "+1-876",
        "+81",
        "+44-1534",
        "+962",
        "+7",
        "+254",
        "+686",
        "+383",
        "+965",
        "+996",
        "+856",
        "+371",
        "+961",
        "+266",
        "+231",
        "+218",
        "+423",
        "+370",
        "+352",
        "+853",
        "+389",
        "+261",
        "+265",
        "+60",
        "+960",
        "+223",
        "+356",
        "+692",
        "+222",
        "+230",
        "+262",
        "+52",
        "+691",
        "+373",
        "+377",
        "+976",
        "+382",
        "+1-664",
        "+212",
        "+258",
        "+95",
        "+264",
        "+674",
        "+977",
        "+31",
        "+599",
        "+687",
        "+64",
        "+505",
        "+227",
        "+234",
        "+683",
        "+850",
        "+1-670",
        "+47",
        "+968",
        "+92",
        "+680",
        "+970",
        "+507",
        "+675",
        "+595",
        "+51",
        "+63",
        "+64",
        "+48",
        "+351",
        "+1-787, 1-939",
        "+974",
        "+242",
        "+262",
        "+40",
        "+7",
        "+250",
        "+590",
        "+290",
        "+1-869",
        "+1-758",
        "+590",
        "+508",
        "+1-784",
        "+685",
        "+378",
        "+239",
        "+966",
        "+221",
        "+381",
        "+248",
        "+232",
        "+65",
        "+1-721",
        "+421",
        "+386",
        "+677",
        "+252",
        "+27",
        "+82",
        "+211",
        "+34",
        "+94",
        "+249",
        "+597",
        "+47",
        "+268",
        "+46",
        "+41",
        "+963",
        "+886",
        "+992",
        "+255",
        "+66",
        "+228",
        "+690",
        "+676",
        "+1-868",
        "+216",
        "+90",
        "+993",
        "+1-649",
        "+688",
        "+1-340",
        "+256",
        "+380",
        "+971",
        "+44",
        " +1",
        "+598",
        "+998",
        "+678",
        "+379",
        "+58",
        "+84",
        "+681",
        "+212",
        "+967",
        "+260",
        "+263",
      ];
      if (
        updateAccountSettingDto.phoneCountry &&
        !countryCode.includes(updateAccountSettingDto.phoneCountry)
      ) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Invalid country code.",
        });
      }

      if (updateAccountSettingDto.dob) {
        if (
          !moment(updateAccountSettingDto.dob, "DD/MM/YYYY", true).isValid()
        ) {
          return response.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid Date Of Birth.",
          });
        }
      }
      await this.userService.updateAccountSettings(
        UserId,
        updateAccountSettingDto
      );
      const updateData = await this.userService.getUser(UserId);
      if (
        updateData && updateData?.email && (!updateData?.email_verified || updateData?.email_verified === undefined)
      ) {
        const mailUrl = this.configService.get("main_url");
        const token = await this.emailService.generateEmailVerificationToken(updateData?.email, UserId);
        const globalContext = {
          formattedDate: moment().format('dddd, MMMM D, YYYY'),
          id: UserId,
          greeting: `Hello ${updateData?.fname ? updateData?.fname + ' ' + updateData?.lname : 'John Doe'}`,
          heading: 'Welcome!',
          confirmEmail: true,
          para1: 'Thank you for registering on our platform. You\'re almost ready to start.',
          para2: 'Simply click the button below to confirm your email address and activate your account.',
          url: `${mailUrl}auth/verify-email?token=${token}`,
          title: 'Confirm Your Email',
        };
        const mailSubject = '[Middn.io] Please verify your email address - https://ico.middn.com/';
        const mailSend = await this.emailService.sendVerificationEmail(updateData, globalContext ,mailSubject)
        if(!mailSend){
          return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: 'Failed to send verification email',
          });
        }
        return response.status(HttpStatus.OK).json({
          message: "User updated successfully. A verification email has been sent.",
        });
      } else {
        return response.status(HttpStatus.OK).json({
          message: "User has been successfully updated",
        });
      }
    } catch (error) {
      return response.status(HttpStatus.BAD_REQUEST).json(error.response);
    }
  }

  /**
   *  * This method retrieves user information based on the authenticated user's address.
   * @param req
   * @param response
   * @returns
   */
  @Get("/getuser")
  async getUser(@Req() req: any, @Res() response) {
    try {
      let userDetails = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      const userId = userDetails._id.toString();
      const User = await this.userService.getUser(userId);
      let newImage = "";
      let imageUrl = "";

      const s3 = this.configService.get("s3");
      const bucketName = this.configService.get("aws_s3_bucket_name");

      if (User.profile) {
        newImage = await s3.getSignedUrl("getObject", {
          Bucket: bucketName,
          Key: User.profile ? User.profile : null,
        });
        const options = {
          uri: newImage,
          encoding: null, // set encoding to null to receive the response body as a Buffer
        };
        const imageBuffer = await rp(options);
        imageUrl = "data:image/jpg;base64," + imageBuffer.toString("base64");
      }
      if (!User.fname_alias) User.fname_alias = "John";
      if (!User.lname_alias) User.lname_alias = "Doe";

      // Setting headers if properties exist
      if (User.is_2FA_login_verified !== undefined) {
        response.setHeader("2FA", User.is_2FA_login_verified);
        User.is_2FA_login_verified = undefined;
      }

      if (User.is_2FA_enabled !== undefined) {
        response.setHeader("2FA_enable", User.is_2FA_enabled);
        User.is_2FA_enabled = undefined;
      }

      if (User.is_verified !== undefined) {
        response.setHeader("kyc_verify", User.is_verified);
        User.is_verified = undefined;
      }

      if (User.kyc_completed !== undefined) {
        response.setHeader("kyc_status", User.kyc_completed);
        User.kyc_completed = undefined;
      }

      if (User.email_verified !== undefined) {
        response.setHeader("is_email_verified", User.email_verified);
        User.email_verified = undefined;
      }

      if (User.email) {
        const encryptedEmail = encryptEmail(User.email);
        response.setHeader("is_email", encryptedEmail); // Set the encrypted email in the header
        User.email = undefined;
      }

      return response.status(HttpStatus.OK).json({
        message: "User found successfully",
        User,
        imageUrl,
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   *
   * @param req
   * @param response
   * @returns
   */
  @Get("/secret")
  async secret(@Req() req, @Res() response) {
    try {
      return response.status(HttpStatus.OK).json({ message: true });
    } catch (err) {
      return response.status(err.status).json(err.response);
    }
  }

  /**
   * This method handles user logout by deleting the authentication token associated with the user.
   * @param req
   * @param response
   * @param updateUsersDto
   * @returns
   */
  @Get("/logout")
  async logout(
    @Req() req: any,
    @Res() response,
    updateUsersDto: UpdateUserProfileDto
  ) {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];
      const isTokenDeleted = await this.tokenService.deleteToken(token);
      if (isTokenDeleted) {
        return response.status(HttpStatus.OK).json({
          message: "Logged out successfully",
        });
      } else {
        return response.status(HttpStatus.OK).json({
          message: "Something went wrong",
        });
      }
    } catch (err) {
      return response.status(err.status).json(err.response);
    }
  }

  /**
   * This method generates a secret key for enabling two-factor authentication (2FA) for the user.
   *
   * @param req
   * @param res
   * @returns
   */
  @SkipThrottle(false)
  @Get("/generate2FASecret")
  async generate2FASecret(@Req() req: any, @Res() res) {
    try {
      let user = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (user?.is_2FA_enabled === true) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .json({ message: "Authentication already enabled" });
      }
      const secret = speakeasy.generateSecret({ length: 20 });
      user.google_auth_secret = secret.base32;
      await user.save();
      res.json({
        secret: secret.base32,
      });
    } catch (err) {
      return res.status(err.status).json(err.response);
    }
  }

  /**
   * This method validates a Time-based One-Time Password (TOTP) token for two-factor authentication (2FA).
   * @param req
   * @param res
   * @returns
   */
  @SkipThrottle(false)
  @Post("validateTOTP")
  async validateTOTP(@Req() req: any, @Res() res) {
    try {
      let user = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      const token = req.body.token;
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!token) {
        return res.status(404).json({ message: "Code not found" });
      }
      if (token.length != 6) {
        return res.status(404).json({ message: "Invalid Code" });
      }
      const secret = user.google_auth_secret;

      const verified = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token,
        window: 0,
      });

      if (verified) {
        user.is_2FA_enabled = true;
        user.is_2FA_login_verified = true;
        await user.save();
      }
      return res.status(HttpStatus.OK).json({ userId: user._id, verified });
    } catch (err) {
      return res.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   *
   * @param req
   * @param res
   * @returns
   */
  @SkipThrottle(false)
  @Post("LoginFailedEmail")
  async LoginFailedEmail(@Req() req: any, @Res() res) {
    try {
      let updateData = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );

      if (updateData && updateData?.email && updateData?.email_verified) {
        const globalContext = {
          formattedDate: moment().format("dddd, MMMM D, YYYY"),
          greeting: `Hello ${updateData?.fname
            ? updateData?.fname + " " + updateData?.lname
            : "John Doe"}`,
          title: "Unusual Login Email",
          para1: `Someone tried to log in too many times in your <a href="https://ico.middn.com/">https://ico.middn.com/</a> account.`
        };
        const mailSubject = `[Middn.io] :: Unusual Login Attempt on https://ico.middn.com/ !!!!`;
        const isVerified = await this.emailService.sendVerificationEmail(
          updateData,
          globalContext,
          mailSubject
        );

        if (isVerified) {
          return res.status(HttpStatus.OK).json({
            message: "Email successfully sent",
          });
        } else {
          return res.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid or expired verification token.",
          });
        }
      }
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "Expired Verification Token.",
        });
      } else {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "Invalid Verification Token",
        });
      }
    }
  }

  /**
   * This method disables two-factor authentication (2FA) for a user.
   * @param req
   * @param res
   * @returns
   */
  @SkipThrottle(false)
  @Get("disable2FA")
  async disable2FA(@Req() req: any, @Res() res) {
    try {
      let user = await this.userService.getFindbyAddress(
        req.headers.authData.verifiedAddress
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (user?.is_2FA_enabled === false) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .json({ message: "Authentication already disabled" });
      }
      user.is_2FA_enabled = false;
      user.is_2FA_login_verified = true;
      user.google_auth_secret = "";
      await user.save();
      if (user && user.email && user?.email_verified) {
        const globalContext = {
          formattedDate: moment().format("dddd, MMMM D, YYYY"),
          greeting: `Hello ${user?.fname
            ? user?.fname + " " + user?.lname + ","
            : "John Doe"}`,
          confirmEmail: false,
          para1: "We are reset your 2FA authentication as per your requested via support.",
          para2: "If you really want to reset 2FA authentication security in your account, then click the button below to confirm and reset 2FA security.",
          title: "2FA Disable Confirmation by Admin"
        };

        const mailSubject = `[Middn.io] :: Disable 2FA Authentication Request`;
        const isVerified = await this.emailService.sendVerificationEmail(
          user,
          globalContext,
          mailSubject
        );

        if (!isVerified) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid or expired verification token.",
          });
        } else {
          console.log("isVerified ", isVerified);
          return res
          .status(HttpStatus.OK)
          .json({ message: "2FA disabled successfully" });
        }
      } else {
        return res
        .status(HttpStatus.OK)
        .json({ message: "2FA disabled successfully" });
      }
      
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "Expired Verification Token.",
        });
      } else {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: "Invalid Verification Token",
        });
      }
    }
  }

  /**
   * 
   * @param response 
   * @param req 
   * @returns 
   */
  @SkipThrottle(false)
  @Post("/changePassword")
  async changePassword(@Res() response, @Req() req: any) {
    try {
      const { oldPassword, newPassword, confirmPassword } = req.body;
      const userAddress = req.headers.authData.verifiedAddress;

      // Fetch user by address
      const user = await this.userService.getFindbyAddress(userAddress);

      // Check if user exists
      if (!user) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "User not found.",
        });
      }

      // Validate old password
      const isOldPasswordValid = await this.userService.comparePasswords(
        oldPassword,
        user.password
      );
      if (!isOldPasswordValid) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Old password is incorrect.",
        });
      }

      // Check if new passwords match
      if (newPassword !== confirmPassword) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "New password and confirm password do not match.",
        });
      }

      // Hash the new password
      const hashedNewPassword = await this.userService.hashPassword(
        newPassword
      );

      // Update the password in the database
      const changePassword = await this.usersModel
        .updateOne({ email: user.email }, { password: hashedNewPassword })
        .exec();

      // Check if password change was successful
      if (changePassword.modifiedCount > 0) {
        return response.status(HttpStatus.OK).json({
          message: "Your password has been changed successfully.",
        });
      } else {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Password change failed.",
        });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: err.message,
      });
    }
  }
}
