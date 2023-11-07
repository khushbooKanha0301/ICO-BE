import {
  NestMiddleware,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { NextFunction, Request, Response } from "express";
import { Model } from "mongoose";
import { IUser } from "src/interface/users.interface";
import { TokenService } from "src/service/token/token.service";
const jwtSecret = "eplba";
var jwt = require("jsonwebtoken");

@Injectable()
export class AuthenticateMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenService: TokenService,
    @InjectModel("user") private userModel: Model<IUser>
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];
      if (token == null) {
        // throw 'NotProvideToken'
        // throw new HttpException('Authorization Token not found', HttpStatus.UNAUTHORIZED)
      }

      const isExistingToken = await this.tokenService.getToken(token);
      if (
        !isExistingToken &&
        req.method !== "POST" &&
        req.originalUrl !== "/login"
      ) {
        return res
          .status(HttpStatus.UNAUTHORIZED)
          .json({ message: "Authorization Token not valid." });
      }
      jwt.verify(token, jwtSecret, async (err, authData) => {
        if (err) {
          console.log(err);
          return res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ message: "Authorization Token not valid." });
        }
        req.headers.address = authData.verifiedAddress;
        const user = await this.userModel
          .findOne({ wallet_address: req.headers.address })
          .exec();
          if (!user && !req.originalUrl.startsWith("/users/verify")) {
            let responseData:{message:string,logout?:any} = { message: "Account not found." };
            if(req.originalUrl == "/users/logout")
            {
              responseData = {...responseData,logout:true}
            }
            return res
              .status(HttpStatus.BAD_REQUEST)
              .json(responseData);
          }
        if (user?.status === "Suspend") {
          let responseData:{message:string,logout?:any} = { message: "You are Suspended by Admin." };
          if(req.originalUrl == "/users/logout")
          {
            responseData = {...responseData,logout:true}
          }
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json(responseData);
        }
        req.headers.authData = authData;
        req.body.authData = authData;
        if (next) {
          next();
        }
      });
    } catch (error) {
      let errorMgs = "Internal server error";
      if (error == "NotProvideToken") {
        errorMgs = "Authorization Token not found";
      }
      throw new HttpException(errorMgs, error);
    }
  }
}
