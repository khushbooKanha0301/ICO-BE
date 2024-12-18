import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
  Req,
} from "@nestjs/common";
import moment from "moment";
import { TransactionsService } from "src/service/transaction/transactions.service";
import { UserService } from "src/service/user/users.service";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ITransaction } from "src/interface/transactions.interface";
import { SkipThrottle } from "@nestjs/throttler";
import { ISales } from "src/interface/sales.interface";
import { IUser } from "src/interface/users.interface";
import { MailerService } from "@nestjs-modules/mailer";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "src/service/email/email.service";

@SkipThrottle()
@Controller("transactions")
export class TransactionsController {
  constructor(
    private readonly transactionService: TransactionsService,
    private readonly userService: UserService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @InjectModel("transaction") private transactionModel: Model<ITransaction>,
    @InjectModel("sales") private salesModel: Model<ISales>,
    @InjectModel("user") private usersModel: Model<IUser>
  ) {}

  /**
   *
   * @param req
   * @param response
   * @returns
   */
  @SkipThrottle(false)
  @Post("/verifyToken")
  async verifyToken(@Req() req: any, @Res() response) {
    try {
      if (!req.body?.wallet_address) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({ status: "failure", message: "Wallet address is missing" });
      }

      const user = await this.userService.getFindbyAddress(
        req.body?.wallet_address
      );

      if (!user) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Wallet address does not exist",
          });
      }

      if (!user?.kyc_completed) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Please complete KYC to Buy Token",
          });
      }

      if (!(user?.kyc_completed === true && user?.is_verified === 1)) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Your KYC is not verified by admin",
          });
      }

      if (user?.status === "Suspend") {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Can't Buy Token, You are Suspended by Admin.",
          });
      }

      if (!req.body?.cryptoAmount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Crypto amount is missing",
        });
      }

      if (!req.body?.amount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Amount is missing",
        });
      }
      const sales = await this.transactionService.getSales();
      let cryptoAmount =
        req.body?.amount / (sales && sales.amount ? sales.amount : 0);
      if (cryptoAmount.toFixed(2) !== req.body?.cryptoAmount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Something Went Wrong.",
        });
      }

      const remainingMid = sales.total_token - sales.user_purchase_token;
      if (remainingMid <= 0) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Token Balance is empty",
        });
      }

      if (remainingMid - req.body?.cryptoAmount < 0) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "All Tokens are sold",
        });
      }

      if (remainingMid) {
        return response.status(HttpStatus.OK).json({
          status: "success",
        });
      } else {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Something went wrong",
        });
      }
    } catch (err) {
      return response.status(HttpStatus.BAD_REQUEST).json(err.response);
    }
  }

  /**
   * This API endpoint is used to create an order for purchasing tokens.
   * @param req
   * @param response
   * @returns
   */
  @SkipThrottle(false)
  @Post("/createOrder")
  async createOrder(@Req() req: any, @Res() response) {
    try {
      if (!req.body?.user_wallet_address) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({ status: "failure", message: "Wallet address is missing" });
      }
      if (!req.body?.transactionHash) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({ status: "failure", message: "Transaction Id is missing" });
      }

      const user = await this.userService.getFindbyAddress(
        req.body?.user_wallet_address
      );

      if (!user) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Wallet address does not exist",
          });
      }

      if (!user?.kyc_completed) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Please complete your KYC to Buy Token",
          });
      }

      if (!(user?.kyc_completed === true && user?.is_verified === 1)) {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Your KYC is not verified by admin",
          });
      }

      if (user?.status === "Suspend") {
        return response
          .status(HttpStatus.BAD_REQUEST)
          .json({
            status: "failure",
            message: "Can't Buy Token, You are Suspended by Admin.",
          });
      }

      if (!req.body?.network) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Network is missing",
        });
      }

      if (!req.body?.cryptoAmount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Crypto amount is missing",
        });
      }

      if (!req.body?.amount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Amount is missing",
        });
      }
      const sales = await this.transactionService.getSales();
      let userPurchaseMid =
        parseFloat(req.body?.cryptoAmount.toFixed(2)) +
        sales.user_purchase_token;

      let cryptoAmount =
        req.body?.amount / (sales && sales.amount ? sales.amount : 0);
      if (cryptoAmount.toFixed(2) !== req.body?.cryptoAmount) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Something Went Wrong.",
        });
      }

      const remainingMid = sales.total_token - userPurchaseMid;
      const updatedSalevalues = { $set: { remaining_token: remainingMid } };

      if (remainingMid <= 0) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "Token Balance is empty",
        });
      }

      if (remainingMid - req.body?.cryptoAmount < 0) {
        return response.status(HttpStatus.BAD_REQUEST).json({
          status: "failure",
          message: "All Tokens are sold",
        });
      }
      let source;
      if (user && user?.referred_by) {
        source = "referral";
      } else {
        source = "purchase";
      }
      const receiver_address = this.configService.get("receiver_address");
      const transactionData = {
        transactionHash: req.body?.transactionHash,
        status: req.body?.status ? req.body?.status : "pending",
        user_wallet_address: req.body?.user_wallet_address,
        receiver_wallet_address: receiver_address,
        network: req.body?.network,
        price_currency: "USDT",
        is_sale: true,
        is_process: false,
        price_amount: req.body?.amount,
        token_cryptoAmount: cryptoAmount,
        gasUsed: req.body?.gasUsed,
        effectiveGasPrice: req.body?.effectiveGasPrice,
        cumulativeGasUsed: req.body?.cumulativeGasUsed,
        blockNumber: req.body?.blockNumber,
        blockHash: req.body?.blockHash,
        created_at: moment.utc().format(),
        source: source,
        sale_name: sales.name,
        sale_type: "website",
      };

      const transaction = await this.transactionService.createTransaction(
        transactionData
      );
      if (transaction.status === "pending" && user &&  user.email && user?.email_verified) {
        const globalContext = {
          formattedDate: moment().format("dddd, MMMM D, YYYY"),
          heading: "Thank you for your contribution!",
          para1: `You have requested to purchase ${req.body?.network} token. Your order has been received and is now being waiting for payment. You order details are show below for your reference.`,
          para2: `If you have not made the payment yet, please send your payments to the following address: ${user?.wallet_address}`,
          para3: `Your order will be processed within 6 hours from the receipt of payment and token balance will appear in your account as soon as we have confirmed your payment.`,
          para4: "Feel free to contact us if you have any questions.",
          order_details: "Order Details:",
          order_id: `OrderID: ${transaction?._id}`,
          transactionHash: `TransactionHash: ${transaction?.transactionHash}`,
          price_amount: `Amount: ${req.body?.amount}`,
          title: "Token Purchase - Order Placed by Online Gateway",
        };

        const mailSubject = `[Middn.io] Order placed for Token Purchase #${user?._id}`;
        await this.emailService.sendVerificationEmail(
          user,
          globalContext,
          mailSubject
        );
      } else if(user && user.email && user?.email_verified){
        const globalContext = {
          formattedDate: moment().format("dddd, MMMM D, YYYY"),
          greeting: `Hello ${
            user?.fname ? user?.fname + " " + user?.lname : "John Doe"
          }`,
          para1: `We noticed that you just tried to purchase ${req.body?.network} token, however we have not received your payment of ${req.body?.amount} via Meta mask for ${transaction?.token_cryptoAmount} Token.`,
          para5:
            "It looks like your payment gateway has been rejected the transaction.",
          para3:
            "If you want to pay manually, please feel free to contact us via support@middn.com",
          order_details: "Order Details:",
          order_id: `OrderID: ${transaction?._id}`,
          transactionHash: `TransactionHash: ${transaction?.transactionHash}`,
          price_amount: `Amount: ${req.body?.amount}`,
          receiver_address: receiver_address,
          title: "Token Purchase - Order Unpaid/Rejected by Gateway",
        };

        const mailSubject = `[Middn.io] Unpaid Order Canceled #${user?._id}`;
        const isVerified = await this.emailService.sendVerificationEmail(
          user,
          globalContext,
          mailSubject
        );

        if (!isVerified) {
          return response.status(HttpStatus.BAD_REQUEST).json({
            message: "Invalid or expired verification token.",
          });
        }
      }
      await this.salesModel.updateOne({ _id: sales?._id }, updatedSalevalues);
      await this.transactionService.updateTransactionData(
        transaction.transactionHash,
        { is_process: true }
      );
      if (transaction) {
        return response.status(HttpStatus.OK).json({
          message: "Order Created Successfully",
          transaction: {
            transactionHash: transaction.transactionHash,
          },
        });
      } else {
        return response.status(HttpStatus.BAD_REQUEST).json({
          message: "Something went wrong",
        });
      }
    } catch (error) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  /**
   *
   * @param req
   * @param response
   * @returns
   */
  @SkipThrottle(false)
  @Put("/updateOrder")
  async updateOrder(@Req() req: any, @Res() response) {
    try {
      const transData = {
        status: req.body.status,
        paid_at: moment.utc().format(),
        is_process: true,
      };
      const receiver_address = this.configService.get("receiver_address");
      await this.transactionService.updateTransactionData(
        req.body.transactionHash,
        transData
      );
      const userTrans = await this.transactionService.getTransactionByOredrId(
        req.body.transactionHash
      );
      const sales = await this.transactionService.getSales();

      if (req.body.status == "paid") {
        const referredFromUser = await this.usersModel.findOne({
          wallet_address: userTrans.user_wallet_address,
        });

        const referredWalletAddress = referredFromUser.referred_by;
        const totalUserTrans = await this.transactionModel.countDocuments({
          user_wallet_address: userTrans.user_wallet_address,
          status: "paid",
          is_sale: true,
        });

        if (
          userTrans.status == "paid" &&
          totalUserTrans == 1 &&
          referredWalletAddress
        ) {
          let priceAmount = Math.round(userTrans.price_amount * (10 / 100));
          let cryptoAmount = Math.round(
            userTrans.token_cryptoAmount * (10 / 100)
          );

          const referredByUserDetails = await this.usersModel.findOne({
            _id: new Object(referredWalletAddress),
          });
          let orderDocument = {
            status: "paid",
            sale_name: userTrans.sale_name,
            sale_type: userTrans.sale_type,
            is_sale: sales ? true : false,
            is_process: true,
            price_currency: "USDT",
            price_amount: priceAmount,
            network: userTrans.network,
            created_at: moment.utc().format(),
            user_wallet_address: referredByUserDetails?.wallet_address,
            token_cryptoAmount: cryptoAmount.toFixed(2),
            source: "referral",
          };
          const trans = await this.transactionService.createTransaction(
            orderDocument
          );

          if (trans) {
            const updatedSalevalues = {
              $set: {
                user_purchase_token:
                  Number(sales?.user_purchase_token) +
                  parseFloat(cryptoAmount.toFixed(2)),
                remaining_token:
                  Number(sales?.remaining_token) -
                  parseFloat(cryptoAmount.toFixed(2)),
              },
            };

            const salesUpdate = await this.salesModel.updateOne(
              { _id: sales?._id },
              updatedSalevalues
            );
            await this.transactionService.updateTransactionData(
              userTrans.transactionHash,
              { is_process: true }
            );
            if (salesUpdate) {
              return response.status(HttpStatus.OK).json({
                message: "success",
              });
            }
          }
        } else {
          const userPurchased =
            Number(sales?.user_purchase_token) +
            Number(userTrans.token_cryptoAmount);
          const updatedSalevalues = {
            $set: { user_purchase_token: userPurchased.toFixed(2) },
          };
          const trans = await this.salesModel.updateOne(
            { _id: sales?._id },
            updatedSalevalues
          );
          if (referredFromUser && referredFromUser?.email && referredFromUser?.email_verified) {
            const globalContext = {
              formattedDate: moment().format("dddd, MMMM D, YYYY"),
              heading: `Congratulation  ${
                referredFromUser?.fname
                  ? referredFromUser?.fname + " " + referredFromUser?.lname
                  : "John Doe"
              }, you order has been processed successfully.`,
              para1: `Thank you for your contribution and purchase our ${req.body?.network} Token!`,
              para2: `Your token balances now appear in your account. Please login into your and check your balance. Please note that, we will send smart contract end of the token sales.`,
              para3: "Feel free to contact us if you have any questions.",
              order_details: "Order Details:",
              order_id: `OrderID: ${userTrans?._id}`,
              transactionHash: `TransactionHash: ${userTrans?.transactionHash}`,
              price_amount: `Amount: ${req.body?.amount}`,
              title: "Token Purchase - Order Successful",
            };

            const mailSubject = `[Middn.io] Token Purchase Successful - Order #${userTrans?._id}`;
             await this.emailService.sendVerificationEmail(
              referredFromUser,
              globalContext,
              mailSubject
            );
          }
          await this.transactionService.updateTransactionData(
            userTrans.transactionHash,
            { is_process: true }
          );
          if (trans) {
            return response.status(HttpStatus.OK).json({
              message: "success",
            });
          }
        }
      } else {
        const userPurchased =
          Number(sales?.remaining_token) +
          parseFloat(userTrans.token_cryptoAmount);
        const updatedSalevalues = { $set: { remaining_token: userPurchased } };
        const trans = await this.salesModel.updateOne(
          { _id: sales?._id },
          updatedSalevalues
        );
        await this.transactionService.updateTransactionData(
          userTrans.transactionHash,
          { is_process: true }
        );
        if (trans) {
          return response.status(HttpStatus.OK).json({
            message: "failed",
          });
        }
      }
    } catch (error) {
      return response.status(HttpStatus.BAD_REQUEST).json({
        message: "Something went wrong",
      });
    }
  }

  /**
   *
   * @param req
   * @param response
   * @returns
   */
  @Get("/checkCurrentSale")
  async checkCurrentSale(@Req() req: any, @Res() response) {
    const sales = await this.transactionService.getSales();
    if (sales) {
      return response.status(HttpStatus.OK).json({
        message: "Sales get successfully",
        sales: sales,
      });
    } else {
      return response.status(HttpStatus.OK).json({
        message: "Sale Not Found",
        sales: null,
      });
    }
  }

  /**
   *
   * @param req
   * @param response
   * @returns
   */
  @Get("/getPurchasedToken")
  async getPurchasedToken(@Req() req: any, @Res() response) {
    const sales = await this.transactionService.getSales();
    if (sales) {
      return response.status(HttpStatus.OK).json({
        message: "Sales get successfully",
        sales: sales,
      });
    } else {
      return response.status(HttpStatus.OK).json({
        message: "Sale Not Found",
        sales: null,
      });
    }
  }

  /**
   * This API endpoint retrieves transactions based on specified filters like type and status.
   * @param req
   * @param response
   * @param body
   * @returns
   */
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

  /**
   * This API endpoint retrieves the total token count for each supported currency (GBP, AUD, EUR)
   * @param req
   * @param response
   * @returns
   */
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
      const totalUserCount = currencyData["USDT"]
        ? currencyData["USDT"].toFixed(2)
        : "0.00";

      let usdtData = await this.transactionService.getUsdtCount(
        req.headers.authData.verifiedAddress
      );

      usdtData = usdtData.map((obj) => {
        return { [obj._id]: obj.total };
      });
      usdtData = Object.assign({}, ...usdtData);
      const totalUsdtCount = usdtData["USDT"]
        ? usdtData["USDT"].toFixed(2)
        : "0.00";

      const totalTokenCount = {
        totalUserCount: totalUserCount,
        totalUsdtCount: totalUsdtCount,
      };

      if (totalUserCount) {
        return response.status(HttpStatus.OK).json({
          message: "get TotalAmount Amount Successfully",
          totalTokenCount: totalTokenCount,
        });
      } else {
        return response.status(HttpStatus.BAD_REQUEST).json({
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
   * This API endpoint retrieves the sale graph values and total token count within a specified date range
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
        return response.status(HttpStatus.BAD_REQUEST).json({
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
   * This API endpoint retrieves the line graph values and total token count within a specified date range
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
        return response.status(HttpStatus.BAD_REQUEST).json({
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
   * This API endpoint retrieves transaction data based on the provided order ID.
   * @param req
   * @param response
   * @param param
   * @returns
   */
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
        return response.status(HttpStatus.BAD_REQUEST).json({
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
