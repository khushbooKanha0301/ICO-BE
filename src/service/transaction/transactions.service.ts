import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ITransaction } from "src/interface/transactions.interface";
import { Model } from "mongoose";
import { ConfigService } from "@nestjs/config";
import * as moment from "moment";
import { IUser } from "src/interface/users.interface";

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel("transaction") private transactionModel: Model<ITransaction>,
    @InjectModel("user") private userModel: Model<IUser>,
    private configService: ConfigService
  ) {}

  async createTransaction(data, wallet_address, cryptoAmount, usdAmount): Promise<any> {
    const newTransaction = await new this.transactionModel({
      tran_id: data.id,
      status: data.status,
      title: data.title,
      do_not_convert: data.do_not_convert,
      orderable_type: data.orderable_type,
      orderable_id: data.orderable_id,
      price_currency: data.price_currency,
      price_amount: data.price_amount,
      lightning_network: data.lightning_network,
      receive_currency: data.receive_currency,
      receive_amount: data.receive_amount,
      created_at: data.created_at,
      order_id: data.order_id,
      payment_url: data.payment_url,
      underpaid_amount: data.underpaid_amount,
      overpaid_amount: data.overpaid_amount,
      is_refundable: data.is_refundable,
      refunds: data.refunds,
      voids: data.voids,
      fees: data.fees,
      token: data.token,
      transaction_status: "Pending",
      wallet_address: wallet_address,
      token_cryptoAmount: cryptoAmount,
      source:"purchase",
      usd_amount:usdAmount
    });
    return newTransaction.save();
  }

  async updateTransactionData(fields:any):Promise<any>
  {
    const token = { token: fields.token };
    if(fields.status == "paid")
    {
      fields.paid_at = moment.utc().format();
    }
    const updatedvalues = { $set: fields };
    if (fields.token) {
      const trans = await this.transactionModel.updateOne(token, updatedvalues);
      if(fields.status == "paid")
      {
        await this.checkForReferralOrder(fields);
      }
      return trans;
    }
    return null;
  }

  async checkForReferralOrder(fields:any)
  {
    const token = { token: fields.token };
    const userTrans = await this.transactionModel.findOne(token);
    if(userTrans)
    {
      const totalUserTrans = await this.transactionModel.countDocuments({wallet_address:userTrans.wallet_address,status:"paid"});
      if(userTrans.status == "paid" && totalUserTrans == 1)
      {
        let priceAmount:any = parseFloat(userTrans.price_amount);
        priceAmount = String(priceAmount * (10/100));
        let cryptoAmount:any = parseFloat(userTrans.token_cryptoAmount);
        cryptoAmount = String(cryptoAmount * (10/100));
        let usdAmount:any = parseFloat(userTrans.usd_amount);
        usdAmount = String(usdAmount * (10/100));
        const referredUser = await this.userModel.findOne({wallet_address:userTrans.wallet_address});
        let referredWalletAddress = referredUser.referred_by; 
        if(referredWalletAddress)
        {
          let orderDocument = {
            status:"paid",
            do_not_convert:false,
            price_currency:fields.price_currency,
            price_amount:priceAmount,
            receive_currency:fields.receive_currency,
            created_at:fields.created_at,
            is_refundable:false,
            transaction_status: "Pending",
            wallet_address: referredWalletAddress,
            token_cryptoAmount: cryptoAmount,
            source:"referral",
            usd_amount: usdAmount
          }
          const newTransaction = await new this.transactionModel(orderDocument);
          newTransaction.save();
        }
      }
    }
  }

  async getTransaction(
    address: string,
    page?: number,
    pageSize?: number,
    typeFilter?:any,
    statusFilter?:any
  ): Promise<any> {
    let transactionsQuery = this.transactionModel.find();
    if(address)
    {
      transactionsQuery = transactionsQuery.where({wallet_address:address});
    }
    if(typeFilter && typeFilter.length > 0)
    {
      transactionsQuery = transactionsQuery.where({source:{$in: typeFilter}});
    }
    if(statusFilter && statusFilter.length > 0)
    {
      transactionsQuery = transactionsQuery.where({status:{$in: statusFilter}});
    }
    if (page && pageSize) {
      // Calculate the number of documents to skip
      const skipCount = (page - 1) * pageSize;
      transactionsQuery = transactionsQuery.skip(skipCount).limit(pageSize);
    }
    const transactions = await transactionsQuery
      .sort({ created_at: "desc" })
      .select("-do_not_convert -token -orderable_type -orderable_id -lightning_network -underpaid_amount -overpaid_amount -fees -is_refundable -refunds -voids -__v")
      .exec();

    if (!transactions) {
      throw new NotFoundException(`Address #${address} not found`);
    }
    return transactions;
  }

  async getTotalMidCount(){
    const midCountResult = await this.transactionModel.aggregate([
      {
        $match: {
          status: {
            $in: ["new", "paid", "pending", "confirming"]
          }
        }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $toDouble: "$token_cryptoAmount" }
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalAmount: { $round: ["$total", 2] },
        },
      },
    ]).exec();
    return (midCountResult && midCountResult[0]?.totalAmount)?midCountResult[0].totalAmount: 0;
  }

  async getTransactionCount(address: string,typeFilter?:any[],statusFilter?:any[]) {
    let transactionsQuery = this.transactionModel.find();
    if(address)
    {
      transactionsQuery = transactionsQuery.where({wallet_address:address});
    }
    if(typeFilter && typeFilter.length > 0)
    {
      transactionsQuery = transactionsQuery.where({source:{$in: typeFilter}});
    }
    if(statusFilter && statusFilter.length > 0)
    {
      transactionsQuery = transactionsQuery.where({status:{$in: statusFilter}});
    }
    const count = await transactionsQuery.countDocuments();
    return count;
  }

  async getSaleGraphTotalToken(
    address: any,
    from_date: any,
    to_date: any
  ): Promise<any> {
    let woToken: {
      status: string;
      created_at: { $gt: any; $lt: any };
      wallet_address?: any;
    } = {
      status: "paid",
      created_at: { $gt: from_date, $lt: to_date },
    };
    if (address !== null) {
      woToken = {
        ...woToken,
        wallet_address: address,
      };
    }

    let totalToken = await this.transactionModel
      .aggregate([
        {
          $match: woToken,
        },
        {
          $group: {
            _id: address ? "$wallet_address" : null,
            totalToken: { $sum: 1 },
          },
        },
      ])
      .exec();
    totalToken =
      totalToken.length && totalToken[0] ? totalToken[0].totalToken : 0;
    return totalToken;
  }

  async getSaleGraphValue(
    address,
    filterType: any,
    from_date: any,
    to_date: any
  ): Promise<any> {
    let woToken: {
      status: string;
      created_at: { $gt: any; $lt: any };
      wallet_address?: any;
    } = {
      status: "paid",
      created_at: { $gt: from_date, $lt: to_date },
    };
    if (address !== null) {
      woToken = {
        ...woToken,
        wallet_address: address,
      };
    }
    const transactions = await this.transactionModel
      .aggregate([
        {
          $match: woToken,
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  filterType === "thisWeekDate" ||
                  filterType === "thisMonthDate" ||
                  filterType === "lastWeek" ||
                  filterType === "lastMonth"
                    ? "%Y-%m-%d"
                    : "%Y-%m",
                date: { $toDate: "$created_at" },
              },
            },
            value: { $sum: 1 },
          },
        },
        {
          $addFields: {
            label: "$_id",
          },
        },
        {
          $sort: {
            label: 1,
          },
        },
      ])
      .exec();
    let mainDates = [];

    if (filterType == "thisWeekDate") {
      const thisWeekStart = moment().startOf("week");
      for (let i = 0; i < 7; i++) {
        const currentDate = thisWeekStart
          .clone()
          .add(i, "days")
          .format("YYYY-MM-DD");
        mainDates.push(currentDate);
      }
    }
    if (filterType == "lastWeek") {
      const previousWeekStart = moment().subtract(1, "weeks").startOf("week");
      for (let i = 0; i < 7; i++) {
        const currentDate = previousWeekStart
          .clone()
          .add(i, "days")
          .format("YYYY-MM-DD");
        mainDates.push(currentDate);
      }
    }
    if (filterType == "lastMonth") {
      const startDate = moment().subtract(1, "month").startOf("month");
      const endDate = moment().subtract(1, "month").endOf("month");
      let currentDatePointer = startDate.clone();

      while (currentDatePointer.isSameOrBefore(endDate, "day")) {
        mainDates.push(currentDatePointer.format("YYYY-MM-DD"));
        currentDatePointer.add(1, "day");
      }
    }
    if (filterType == "last3Months") {
      const currentMonth = moment();
      for (let i = 0; i < 3; i++) {
        const previousMonth = currentMonth.clone().subtract(i + 1, "months");
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
      mainDates = mainDates.reverse();
    }
    if (filterType == "last6Months") {
      const currentMonth = moment();
      for (let i = 0; i < 6; i++) {
        const previousMonth = currentMonth.clone().subtract(i + 1, "months");
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
      mainDates = mainDates.reverse();
    }
    if (filterType == "lastYear") {
      const currentYear = moment().year();
      for (let i = 0; i < 12; i++) {
        const previousMonth = moment()
          .year(currentYear - 1)
          .month(i);
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
    } 
    if (filterType === "thisMonthDate") {
      // Calculate dates for the current month
      const thisMonthStart = moment().startOf("month");
      const thisMonthEnd = moment().endOf("month");

      let currentDatePointer = thisMonthStart.clone();
      while (currentDatePointer.isSameOrBefore(thisMonthEnd, "day")) {
        mainDates.push(currentDatePointer.format("YYYY-MM-DD"));
        currentDatePointer.add(1, "day");
      }
    } 
    if (filterType === "thisYearDate") {
      const currentYear = moment().year()
      for (let i = 0; i < 12; i++) {
        const thisMonth = moment().year(currentYear).month(i)
        const formattedMonth = thisMonth.format('YYYY-MM')
        mainDates.push(formattedMonth)
      }
    }

    let data = transactions?.map((trans) => {
      let key = trans.label;
      return { [key]: trans.value };
    });
    data = { ...Object.assign({}, ...data) };

    const result = mainDates?.map((d) => {
      if (data[d]) {
        return { label: d, value: data[d] };
      } else {
        return { label: d, value: 0 };
      }
    });
    return result;
  }

  async getLineGraphTotalToken(
    address: any,
    from_date: any,
    to_date: any
  ): Promise<any> {
    let woToken: {
      status: string;
      created_at: { $gt: any; $lt: any };
      wallet_address?: any;
    } = {
      status: "paid",
      created_at: { $gt: from_date, $lt: to_date },
    };
    if (address !== null) {
      woToken = {
        ...woToken,
        wallet_address: address,
      };
    }

    let totalToken = await this.transactionModel
      .aggregate([
        {
          $match: woToken,
        },
        {
          $group: {
            _id: address ? "$wallet_address" : null,
            totalToken: { $sum: 1 },
          },
        },
      ])
      .exec();
    totalToken =
      totalToken.length && totalToken[0] ? totalToken[0].totalToken : 0;
    return totalToken;
  }

  async getLineGraphValue(
    address,
    filterType: any,
    from_date: any,
    to_date: any
  ): Promise<any> {
    let woToken: {
      status: string;
      created_at: { $gt: any; $lt: any };
      wallet_address?: any;
    } = {
      status: "paid",
      created_at: { $gt: from_date, $lt: to_date },
    };
    if (address !== null) {
      woToken = {
        ...woToken,
        wallet_address: address,
      };
    }
    const transactions = await this.transactionModel
      .aggregate([
        {
          $match: woToken,
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  filterType === "thisWeekDate" ||
                  filterType === "thisMonthDate" ||
                  filterType === "lastWeek" ||
                  filterType === "lastMonth"
                    ? "%Y-%m-%d"
                    : "%Y-%m",
                date: { $toDate: "$created_at" },
              },
            },
            value: { $sum: 1 },
          },
        },
        {
          $addFields: {
            label: "$_id",
          },
        },
        {
          $sort: {
            label: 1,
          },
        },
      ])
      .exec();
    const mainDates = [];

    if (filterType == "thisWeekDate") {
      const thisWeekStart = moment().subtract(1, "weeks").startOf("week");
      for (let i = 0; i < 7; i++) {
        const currentDate = thisWeekStart
          .clone()
          .add(i, "days")
          .format("YYYY-MM-DD");
        mainDates.push(currentDate);
      }
    }
    if (filterType == "lastWeek") {
      const previousWeekStart = moment().subtract(2, "weeks").startOf("week");
      for (let i = 0; i < 7; i++) {
        const currentDate = previousWeekStart
          .clone()
          .add(i, "days")
          .format("YYYY-MM-DD");
        mainDates.push(currentDate);
      }
    }
    if (filterType == "lastMonth") {
      const startDate = moment().subtract(2, "month").startOf("month");
      const endDate = moment().subtract(2, "month").endOf("month");
      let currentDatePointer = startDate.clone();

      while (currentDatePointer.isSameOrBefore(endDate, "day")) {
        mainDates.push(currentDatePointer.format("YYYY-MM-DD"));
        currentDatePointer.add(1, "day");
      }
    }
    if (filterType == "last3Months") {
      const currentMonth = moment();
      for (let i = 3; i < 6; i++) {
        const previousMonth = currentMonth.clone().subtract(i + 1, "months");
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
    }
    if (filterType == "last6Months") {
      const currentMonth = moment();
      for (let i = 6; i < 12; i++) {
        const previousMonth = currentMonth.clone().subtract(i + 1, "months");
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
    }
    if (filterType == "lastYear") {
      const currentYear = moment().year();
      for (let i = 0; i < 12; i++) {
        const previousMonth = moment()
          .year(currentYear - 2)
          .month(i);
        const formattedMonth = previousMonth.format("YYYY-MM");
        mainDates.push(formattedMonth);
      }
    }
    if (filterType === "thisMonthDate") {
      // Calculate dates for the current month
      const thisMonthStart = moment().startOf("month");
      const thisMonthEnd = moment().endOf("month");
      let currentDatePointer = thisMonthStart.clone();
      while (currentDatePointer.isSameOrBefore(thisMonthEnd, "day")) {
        mainDates.push(currentDatePointer.format("YYYY-MM-DD"));
        currentDatePointer.add(1, "day");
      }
    } 
    if (filterType === "thisYearDate") {
      const currentYear = moment().year()
      for (let i = 0; i < 12; i++) {
        const thisMonth = moment().year(currentYear).month(i)
        const formattedMonth = thisMonth.format('YYYY-MM')
        mainDates.push(formattedMonth)
      }
    }

    let data = transactions?.map((trans) => {
      let key = trans.label;
      return { [key]: trans.value };
    });
    data = { ...Object.assign({}, ...data) };

    const result = mainDates?.map((d) => {
      if (data[d]) {
        return { label: d, value: data[d] };
      } else {
        return { label: d, value: 0 };
      }
    });
    return result;
  }
  
  async getTransactionByOredrId(orderId): Promise<any> {
    const transaction = this.transactionModel
      .findOne({ tran_id: orderId })
      .select("-_id -do_not_convert -orderable_type -orderable_id -lightning_network -payment_url -underpaid_amount -overpaid_amount -is_refundable -refunds -voids -fees -source -__v")
      .exec();
    return transaction;
  }

  async getTokenCount(address?:string) {
    let whereQuery: {
      status: any;
      wallet_address?: any;
    } = {
      status: {
        $in: ["new", "paid", "pending", "confirming"]
      }
    };
    if(address)
    {
      whereQuery = {
        ...whereQuery,
        wallet_address:address
      }
    }
    const tokenCountResult = await this.transactionModel.aggregate([
      {
        $match:whereQuery
      },
      {
        $group: {
          _id: '$price_currency',
          total: {
            $sum: { $toDouble: "$token_cryptoAmount" }
          }
        }
      },
    ]).exec();
    return tokenCountResult;
  }
}
