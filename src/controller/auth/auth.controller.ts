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
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { SkipThrottle } from "@nestjs/throttler";
import axios from "axios";
import { Model } from "mongoose";
import { ITransaction } from "src/interface/transactions.interface";
import { TransactionsService } from "src/service/transaction/transactions.service";
import { UserService } from "src/service/user/users.service";
var jwt = require("jsonwebtoken");
const getSignMessage = (address, nonce) => {
  return `Please sign this message for address ${address}:\n\n${nonce}`;
};
const Web3 = require("web3");
const jwtSecret = "eplba";
const web3 = new Web3("https://cloudflare-eth.com/");

@SkipThrottle()
@Controller("auth")
export class AuthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly transactionService: TransactionsService,
    @InjectModel("transaction") private transactionModel: Model<ITransaction>
  ) {}

  /**
   * 
   * @param response 
   * @param param 
   * @returns 
   */
  @Get("/nonce/:addressId")
  async generateToken(@Res() response, @Param() param: { addressId: string }) {
    try {
      // Generate a nonce (timestamp) for client-side authentication
      const nonce = new Date().getTime();
      const address = param.addressId;
      
      // Generate a temporary token (nonce) signed with a JWT secret key
      const tempToken = jwt.sign({ nonce, address }, jwtSecret, {
        expiresIn: "120s", // Token expiration time: 120 seconds
      });
      
      // Create a message for cryptographic operations using the address ID and nonce
      const message = getSignMessage(address, nonce);
      
      // Send the generated token and message as a JSON response
      return response.json({ tempToken, message });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   *  Retrieve user details from the userService based on the provided address
   * @param response 
   * @param address 
   * @returns 
   */
  @Get("/getuser/:address")
  async getUserDetailByAddress(
    @Res() response,
    @Param("address") address: string
  ) {
    try {
      let user = await this.userService.getOnlyUserBioByAddress(address);

      let docUrl = "";
      if (user.profile) {
        const s3 = this.configService.get("s3");
        const bucketName = this.configService.get("aws_s3_bucket_name");
        docUrl = await s3.getSignedUrl("getObject", {
          Bucket: bucketName,
          Key: user.profile ? user.profile : "",
          Expires: 604800,
        });
      }

      user.fname_alias = user.fname_alias ? user.fname_alias : "John";
      user.lname_alias = user.lname_alias ? user.lname_alias : "Doe";
      return response.json({ docUrl: docUrl, user: user });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   * Retrieves sale graph values based on the provided options and date range.
   * @param req 
   * @param response 
   * @returns 
   */
  @Post("/getSaleGrapthValues")
  async getSaleGrapthValues(@Req() req: any, @Res() response) {
    try {
      const option = req.body.option;
      const from_date = req.body.from_date;
      const to_date = req.body.to_date;
      const address = null;
      const transactionData = await this.transactionService.getSaleGraphValue(
        address,
        option,
        from_date,
        to_date
      );
      const totalToken = await this.transactionService.getSaleGraphTotalToken(
        address,
        from_date,
        to_date
      );
      if (transactionData) {
        return response.status(HttpStatus.OK).json({
          message: "get TotalAmount Amount Successfully",
          transactionData: transactionData,
          totalToken: totalToken,
        });
      } else {
        return response.status(HttpStatus.OK).json({
          message: "Something went wrong",
        });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  /**
   * Retrieves line graph values based on the provided options and date range.
   * @param req 
   * @param response 
   * @returns 
   */
  @Post("/getLineGrapthValues")
  async getLineGrapthValues(@Req() req: any, @Res() response) {
    try {
      const option = req.body.option;
      const from_date = req.body.from_date;
      const to_date = req.body.to_date;
      const address = null;
      const transactionData = await this.transactionService.getLineGraphValue(
        address,
        option,
        from_date,
        to_date
      );
      const totalToken = await this.transactionService.getLineGraphTotalToken(
        address,
        from_date,
        to_date
      );
      if (transactionData) {
        return response.status(HttpStatus.OK).json({
          message: "get TotalAmount Amount Successfully",
          transactionData: transactionData,
          totalToken: totalToken,
        });
      } else {
        return response.status(HttpStatus.OK).json({
          message: "Something went wrong",
        });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  /**
  * Handles callback requests.
  * @param req 
  * @param response 
  * @returns 
  */
  @Post("/callBack")
  async callBack(@Req() req: any, @Res() response) {
    const fields = req.body;
    if (!fields) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "failure",
      });
    }
    const trans = await this.transactionService.updateTransactionData(fields);
    if (trans) {
      return response.status(HttpStatus.OK).json({
        message: "success",
      });
    } else {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "failure",
      });
    }
  }

  /**
   * Retrieves the total count of MID (Merchant ID) records.
   * @param req 
   * @param response 
   * @returns 
   */
  @Get("/getTotalMid")
  async getTotalMid(@Req() req: any, @Res() response) {
    try {
      let totalAmount = await this.transactionService.getTotalMidCount();
      return response.status(HttpStatus.OK).json({
        message: "get TotalAmount Amount Successfully",
        totalAmount: totalAmount,
      });
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  /**
   *  Retrieves details of the cryptocurrency amount based on the provided USD amount and cryptocurrency symbol.
   * @param req 
   * @param response 
   * @param body 
   * @returns 
   */
  @Post("/getCryptoAmountDetails")
  async getCryptoAmountDetails(
    @Req() req: any,
    @Res() response,
    @Body() body: { usdAmount: any; cryptoSymbol: any }
  ) {
    try {
      if (!req.body.cryptoSymbol) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Please select crypto currency",
        });
      } else {
        let cryptoAmount = null;
        if (req.body.cryptoSymbol == "USD") {
          cryptoAmount = body.usdAmount * 0.49;
        } else {
          let responseData = await axios.get(
            `https://api.coingate.com/v2/rates/merchant/${req.body.cryptoSymbol}/USD`
          );
          let amountUSD = body.usdAmount * responseData.data;
          cryptoAmount = amountUSD * 0.49;
        }
        if (cryptoAmount) {
          return response.status(HttpStatus.OK).json({
            message: `${req.body.cryptoSymbol}: ${req.body.usdAmount} => MID: ${cryptoAmount}`,
            amount: cryptoAmount,
          });
        } else {
          return response.status(HttpStatus.OK).json({
            message: "Something went wrong",
          });
        }
      }
    } catch (err) {
      return response.status(err.status).json(err.response);
    }
  }
}
