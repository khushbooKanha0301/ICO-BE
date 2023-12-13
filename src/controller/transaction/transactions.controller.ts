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
import axios from "axios";
import { TransactionsService } from "src/service/transaction/transactions.service";
import { ConfigService } from "@nestjs/config";
import { UserService } from "src/service/user/users.service";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ITransaction } from "src/interface/transactions.interface";
import { SkipThrottle } from "@nestjs/throttler";
@SkipThrottle()
@Controller("transactions")
export class TransactionsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly transactionService: TransactionsService,
    private readonly userService: UserService,
    @InjectModel("transaction") private transactionModel: Model<ITransaction>
  ) {}

  @SkipThrottle(false)
  @Post("/createOrder")
  async createOrder(@Req() req: any, @Res() response) {
    if (!req.body?.wallet_address) {
      return response.status(HttpStatus.OK).json({
        message: "Wallet address is missing",
      });
    }

    const user = await this.userService.getFindbyAddress(
      req.body?.wallet_address
    );

    if (!user) {
      return response.status(HttpStatus.OK).json({
        message: "Wallet address does not exist",
      });
    }

    if (user?.status === "Suspend") {
      return response
        .status(HttpStatus.OK)
        .json({ message: "Can't Buy Token, You are Suspended by Admin." });
    }

    if (!req.body?.crypto_currency) {
      return response.status(HttpStatus.OK).json({
        message: "Crypto currency is missing",
      });
    }

    if (!req.body?.cryptoAmount) {
      return response.status(HttpStatus.OK).json({
        message: "Crypto amount is missing",
      });
    }

    if (!req.body?.amount) {
      return response.status(HttpStatus.OK).json({
        message: "Amount is missing",
      });
    }

    const raisedMid = await this.transactionService.getTotalMidCount();
    const remainingMid = 14000000 - raisedMid;

    if (remainingMid <= 0) {
      return response.status(HttpStatus.OK).json({
        message: "Token Balance is empty",
      });
    }

    if (remainingMid - req.body?.cryptoAmount < 0) {
      return response.status(HttpStatus.OK).json({
        message: "Token Balance is empty",
      });
    }

    let responseData = await axios.get(
      `https://api.coingate.com/v2/rates/merchant/${req.body.crypto_currency}/USD`
    );
    let amountUSD = req.body?.amount * responseData.data;
    let apiCryptoAmount = amountUSD * 0.49;
    if(apiCryptoAmount != req.body?.cryptoAmount)
    {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something Went Wrong.",
      });
    }

    const coingate_token = this.configService.get("coingate_token");
    const res = await axios.post(
      "https://api-sandbox.coingate.com/v2/orders",
      {
        price_amount: Number(req.body?.amount),
        price_currency: req.body?.crypto_currency,
        receive_currency: "USD",
        callback_url: "http://164.90.183.188:5000/orders/callback",
        success_url: "https://ico.middn.com/buy-token?success=true",
        cancel_url: "https://ico.middn.com/buy-token?success=false",
      },
      {
        headers: {
          Authorization: `Bearer ${coingate_token}`,
        },
      }
    );
    const transaction = await this.transactionService.createTransaction(
      res.data,
      req.body?.wallet_address,
      req.body?.cryptoAmount,
      amountUSD
    );
    if (transaction) {
      return response.status(HttpStatus.OK).json({
        message: "Order create successfully",
        transaction: {
          tran_id:transaction.tran_id,
          payment_url:transaction.payment_url
        },
      });
    } else {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  @Post("/getTransactions")
  async getTransactions(
    @Req() req,
    @Res() response,
    @Body() body: { typeFilter?: any[]; statusFilter?: any[] }
  ) {
    const page = req.query.page ? req.query.page : 1;
    const pageSize = req.query.pageSize ? req.query.pageSize : 10;
    const typeFilter = req.body.typeFilter;
    const statusFilter = req.body.statusFilter;
    const transactions = await this.transactionService.getTransaction(
      req.headers.authData.verifiedAddress,
      page,
      pageSize,
      typeFilter,
      statusFilter
    );
    const transactionsCount = await this.transactionService.getTransactionCount(
      req.headers.authData.verifiedAddress,
      typeFilter,
      statusFilter
    );
    if (transactions) {
      return response.status(HttpStatus.OK).json({
        message: "Transactions get successfully",
        transactions: transactions,
        totalTransactionsCount: transactionsCount,
      });
    } else {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  @Get("/getTokenCount")
  async getTokenCount(@Req() req: any, @Res() response) {
    try {
      let currencyData = await this.transactionService.getTokenCount(
        req.headers.authData.verifiedAddress
      );
      currencyData = currencyData.map((obj) => {
        return { [obj._id]: obj.total };
      });
      currencyData = Object.assign({}, ...currencyData);
      const tokenData = {
        gbpCount: currencyData["GBP"] ? currencyData["GBP"].toFixed(2) : "0.00",
        audCount: currencyData["AUD"] ? currencyData["AUD"].toFixed(2) : "0.00",
        eurCount: currencyData["EUR"] ? currencyData["EUR"].toFixed(2) : "0.00",
      };
      if (tokenData) {
        return response.status(HttpStatus.OK).json({
          message: "get TotalAmount Amount Successfully",
          tokenData: tokenData,
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

  @Post("/getSaleGrapthValues")
  async getSaleGrapthValues(@Req() req: any, @Res() response) {
    try {
      const option = req.body.option;
      const from_date = req.body.from_date;
      const to_date = req.body.to_date;
      const transactionData = await this.transactionService.getSaleGraphValue(
        req.headers.authData.verifiedAddress,
        option,
        from_date,
        to_date
      );
      const totalToken = await this.transactionService.getSaleGraphTotalToken(
        req.headers.authData.verifiedAddress,
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

  @Post("/getLineGrapthValues")
  async getLineGrapthValues(@Req() req: any, @Res() response) {
    try {
      const option = req.body.option;
      const from_date = req.body.from_date;
      const to_date = req.body.to_date;
      const transactionData = await this.transactionService.getLineGraphValue(
        req.headers.authData.verifiedAddress,
        option,
        from_date,
        to_date
      );
      const totalToken = await this.transactionService.getLineGraphTotalToken(
        req.headers.authData.verifiedAddress,
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

  @Get("/getTransactionByOrderId/:orderId")
  async getTransactionByOrderId(
    @Req() req: any,
    @Res() response,
    @Param() param: { orderId: string }
  ) {
    try {
      const transactionData =
        await this.transactionService.getTransactionByOredrId(param.orderId);
      if (transactionData) {
        return response.status(HttpStatus.OK).json({
          message: "Transaction fetch Successfully",
          transactionData: transactionData,
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
}
