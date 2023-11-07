import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { CreateUserDto } from "src/dto/create-users.dto";
import { IUser } from "src/interface/users.interface";
import { Model } from "mongoose";
import { UpdateUserProfileDto } from "src/dto/update-users-profile.dto";
import { ConfigService } from "@nestjs/config";
import { UpdateAccountSettingsDto } from "src/dto/update-account-settings.dto";
import { UpdateKycDataDto } from "src/dto/update-kyc.dto";
const moment = require('moment');

@Injectable()
export class UserService {
  constructor(
    @InjectModel("user") private userModel: Model<IUser>,
    private configService: ConfigService
  ) {}
  async createUser(CreateUserDto: CreateUserDto): Promise<IUser> {
    const newUser = await new this.userModel(CreateUserDto);
    return newUser.save();
  }
  async updateUser(
    userId: string,
    body: UpdateUserProfileDto,
    file: Express.Multer.File = null,
    bucketName: string = null
  ): Promise<IUser> {
    let key = null;
    if (!!file) {
      const s3 = this.configService.get("s3");
      const bucketName = this.configService.get("aws_s3_bucket_name");
      key = new Date().valueOf() + "_" + file.originalname;

      const params = {
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
      };

      await new Promise(async (resolve, reject) => {
        await s3.upload(params, async function (err, data) {
          if (!err) {
            return resolve(true);
          } else {
            return reject(false);
          }
        });
      });
    }

    const existingUser = await this.userModel.findByIdAndUpdate(
      userId,
      file ? { ...body, profile: key } : { ...body },{new: true}
    );
    if (!existingUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return existingUser;
  }

  async updateAccountSettings(
    userId: string,
    body: UpdateAccountSettingsDto
  ): Promise<IUser> {
    const existingUser = await this.userModel.findByIdAndUpdate(userId, {
      ...body,
    });
    if (!existingUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return existingUser;
  }

  async updateKyc(
    userId: string,
    UpdateKycDto: UpdateKycDataDto,
    passport_url: any = null,
    user_photo_url: any = null
  ): Promise<any> {
    let passport_url_key = null;
    if (!!passport_url && !!passport_url.buffer) {
      const s3 = this.configService.get("s3");
      const bucketName = this.configService.get("aws_s3_bucket_name");
      passport_url_key = new Date().valueOf() + "_" + passport_url.originalname;

      const params = {
        Bucket: bucketName,
        Key: passport_url_key,
        Body: passport_url.buffer,
      };

      await new Promise(async (resolve, reject) => {
        await s3.upload(params, async function (err, data) {
          if (!err) {
            return resolve(true);
          } else {
            return reject(false);
          }
        });
      });
    }
    let user_photo_url_key = null;
    if (!!user_photo_url && !!user_photo_url.buffer) {
      const s3 = this.configService.get("s3");
      const bucketName = this.configService.get("aws_s3_bucket_name");
      user_photo_url_key =
        new Date().valueOf() + "_" + user_photo_url.originalname;

      const params = {
        Bucket: bucketName,
        Key: user_photo_url_key,
        Body: user_photo_url.buffer,
      };

      await new Promise(async (resolve, reject) => {
        await s3.upload(params, async function (err, data) {
          if (!err) {
            return resolve(true);
          } else {
            return reject(false);
          }
        });
      });
    }
    var currentDate = moment.utc().format();

    const updateObject = {
      ...UpdateKycDto,
      passport_url: passport_url_key,
      user_photo_url: user_photo_url_key,
      kyc_completed: true,
      is_kyc_deleted: false,
      is_verified: 0,
      status: "Active",
      kyc_submitted_date:currentDate,
      admin_checked_at:""
    };

    const existingUser = await this.userModel.findByIdAndUpdate(
      userId,
      { ...updateObject },
      { new: true }
    );
    if (!existingUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return existingUser;
  }

  async getUser(userId: string): Promise<any> {
    const existingUser = await this.userModel
      .findById(userId)
      .select("-_id -__v -nonce -referred_by -is_kyc_deleted -google_auth_secret -admin_checked_at -kyc_submitted_date")
      .exec();
    if (!existingUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return existingUser;
  }
  async getFindbyAddress(address: string): Promise<any> {
    const existingUser = await this.userModel
      .findOne({ wallet_address: address })
      .exec();
    return existingUser;
  }
  async deleteUser(userId: string): Promise<IUser> {
    const deletedUser = await this.userModel.findByIdAndDelete(userId);
    if (!deletedUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return deletedUser;
  }
  async getAllUsersExceptAuth(userId: string): Promise<any> {
    const allUsers = await this.userModel.find();
    const existingUser = allUsers.filter((user) => user.id !== userId);
    return existingUser;
  }
  async getUserDetailByAddress(address: string): Promise<any> {
    const existingUser = await this.userModel
      .findOne({ wallet_address: address })
      .exec();
    if (!existingUser) {
      throw new NotFoundException(`Address #${address} not found`);
    }
    return existingUser;
  }
  async getOnlyUserBioByAddress(address: string): Promise<any> {
    const existingUser = await this.userModel
      .findOne({ wallet_address: address })
      .select("-_id -nonce -__v")
      .exec();
    if (!existingUser) {
      throw new NotFoundException(`Address #${address} not found`);
    }
    return existingUser;
  }
}
