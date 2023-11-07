import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
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
import { TokenService } from "src/service/token/token.service";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { Express } from "express";
import { ConfigService } from "@nestjs/config";
import { UpdateAccountSettingsDto } from "src/dto/update-account-settings.dto";
import { UpdateKycDataDto } from "src/dto/update-kyc.dto";
import { SkipThrottle } from "@nestjs/throttler";
import { TransactionsService } from "src/service/transaction/transactions.service";
const rp = require("request-promise-native");
const moment = require("moment");
const speakeasy = require("speakeasy");

var jwt = require("jsonwebtoken");
const getSignMessage = (address, nonce) => {
  return `Please sign this message for address ${address}:\n\n${nonce}`;
};
const Web3 = require("web3");

const web3 = new Web3("https://cloudflare-eth.com/");

@SkipThrottle()
@Controller("users")
export class UsersController {
  constructor(
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
    private readonly transactionService: TransactionsService
  ) {}

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
          userInfo: userInfo,
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
      if(!updateKycDto.postal_code.match(pattern))
      {
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

      const data = await this.userService.updateKyc(
        UserId,
        updateKycDto,
        passport_url,
        user_photo_url
      );
      return response.status(HttpStatus.OK).json({
        message: "Users has been successfully updated.",
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }
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
        if (file[0].size / (1024 * 1024) > allowed_file_size || file[0].size < 10240) {
          return response
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: "File size should come between 10 KB to 5120 KB" });
        }
        return response
          .status(HttpStatus.OK)
          .json({ message: "File uploaded successfully." });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }
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
      if(!updateAccountSettingDto.fname)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "First Name is missing.",
        });
      }
      if(!updateAccountSettingDto.lname)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Last Name is missing.",
        });
      }
      if(!updateAccountSettingDto.email)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Email is missing.",
        });
      }
      if(!updateAccountSettingDto.phone)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Phone is missing.",
        });
      }
      if(!updateAccountSettingDto.city)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "City is missing.",
        });
      }
      if(!updateAccountSettingDto.phoneCountry)
      {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Phone Country is missing.",
        });
      }
      if(!updateAccountSettingDto.dob)
      {
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
      return response.status(HttpStatus.OK).json({
        message: "Users has been successfully updated.",
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

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

      return response.status(HttpStatus.OK).json({
        message: "User found successfully",
        User,
        imageUrl,
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }
  @Get("/secret")
  async secret(@Req() req, @Res() response) {
    try {
      return response.status(HttpStatus.OK).json({ message: true });
    } catch (err) {
      return response.status(err.status).json(err.response);
    }
  }

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
          .json({message:"Authentication already enabled"});
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
          .json({message:"Authentication already disabled"});
      }
      user.is_2FA_enabled = false;
      user.is_2FA_login_verified = true;
      user.google_auth_secret = "";
      await user.save();
      return res
        .status(HttpStatus.OK)
        .json({ message: "2FA disabled successfully" });
    } catch (err) {
      return res.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }
}
