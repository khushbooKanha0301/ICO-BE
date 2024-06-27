import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { TransactionsService } from "src/service/transaction/transactions.service";
import moment from "moment";
import * as schedule from "node-schedule";
import Web3 from "web3";
import axios from "axios";
import { Cron } from "@nestjs/schedule";

import { ISales } from "src/interface/sales.interface";
const ETHERSCAN_API_KEY = "7ATF9VTNMJCSVFCYYKA5HJBAFI5FEX8TCF";
const BSCSCAN_API_KEY = "W11WIQSRZBP3CV14T5K94BD113HX1ASP77";
const FANTOM_API_KEY = "AMEB7ZHTNCBV5WAVB9UC7WBIZV9Z9ZQSCN";
const POLYGON_API_KEY = "11KMKMT41HFN8HXVJDWXUW2MFSJJFXY34H";
const RECEIVER_ADDRESS = "0xf52543f63073140b3DB0393904DB07e3bb07484D";
const ETH_CONTRACT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FTM_USDT_ADDRESS = "0x049d68029688eAbF473097a2fC38ef61633A3C7A";
const MATIC_USDT_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const BNB_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

@Injectable()
export class AppService {
  private web3: Web3;
  private scheduledTime: moment.Moment;
  private scheduledTimeMain: moment.Moment;
  
  constructor(
    @InjectModel("transaction") private transactionModel: Model<any>,
    @InjectModel("sales") private salesModel: Model<ISales>,
    private readonly transactionService: TransactionsService,
  ) {
    this.web3 = new Web3(
      new Web3.providers.HttpProvider(
        "https://mainnet.infura.io/v3/b16f8eb83d5749d18959c29c249e51f1"
      )
    );
    this.scheduleRecurringCheck();
  }

  private async fetchTransactionData() {
    const networks = {
      FTM: {
        usdtAddress: FTM_USDT_ADDRESS,
        apiKey: FANTOM_API_KEY,
        network: "FTM",
      },
      ETH: {
        usdtAddress: ETH_CONTRACT_ADDRESS,
        apiKey: ETHERSCAN_API_KEY,
        network: "ETH",
      },
      BNB: {
        usdtAddress: BNB_USDT_ADDRESS,
        apiKey: BSCSCAN_API_KEY,
        network: "BNB",
      },
      MATIC: {
        usdtAddress: MATIC_USDT_ADDRESS,
        apiKey: POLYGON_API_KEY,
        network: "MATIC",
      },
    };

    // Calculate block numbers for the last 2 hours
    const { startBlock, endBlock } = await this.get10MinuteBlockRange();
    try {
      const responses = await Promise.all([
        this.fetchTransactionsForNetwork(networks["FTM"], startBlock, endBlock),
        this.fetchTransactionsForNetwork(networks["ETH"], startBlock, endBlock),
        this.fetchTransactionsForNetwork(networks["BNB"], startBlock, endBlock),
        this.fetchTransactionsForNetwork(
          networks["MATIC"],
          startBlock,
          endBlock
        ),
      ]);

      let allTransactions = [];
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        if (response.data && response.data.result) {
          const transactions = await this.parseLogs(
            response.data.result,
            Object.keys(networks)[i]
          );
          allTransactions = allTransactions.concat(transactions);
        }
      }
      const userTransactions = await Promise.all(
        allTransactions.map(async (tx) => {
          const data = await this.transactionService.getTransactionByOredrId(
            tx.transactionHash
          );
          if (!data) return tx;
          return null;
        })
      );
      const transactionsWithNoData = userTransactions.filter(
        (tx) => tx !== null
      );

      await Promise.all(
        transactionsWithNoData.map(async (tx) => {
          const usdtAmount = parseFloat(
            this.web3.utils.fromWei(tx.value, "ether")
          );
          const formattedCurrentDate = moment(tx.createDate).format(
            "YYYY-MM-DD[T]HH:mm:ss[Z]"
          );
          let sales = await this.transactionService.checkOutsideSales(
            formattedCurrentDate
          );

          let cryptoAmount = 0;
          let is_sale = false;
          let userPurchaseMid;
          let remainingMid;
          if (sales) {
            cryptoAmount = usdtAmount / sales.amount;
            is_sale = true;
            userPurchaseMid = await this.transactionService.getTotalMidCount(
              sales.name
            );
            userPurchaseMid =
              parseFloat(cryptoAmount.toFixed(2)) + userPurchaseMid;
            remainingMid = sales.total_token - userPurchaseMid;

            if (remainingMid <= 0) {
              return null;
            }

            if (remainingMid - parseFloat(cryptoAmount.toFixed(2)) < 0) {
              return null;
            }
          } else {
            sales = await this.transactionService.checkOutsideNearSales(
              formattedCurrentDate
            );
            if (sales) {
              cryptoAmount = usdtAmount / sales.amount;
              is_sale = false;
            } else {
              is_sale = false;
              cryptoAmount = 0;
            }
          }

          const createOrder = {
            transactionHash: tx.transactionHash,
            price_amount:usdtAmount,
            status: tx.method === "transfer" ? "paid" : "pending",
            user_wallet_address: tx.from,
            receiver_wallet_address: tx.to,
            blockHash: tx.blockHash,
            effectiveGasPrice: tx.gasPrice,
            gasUsed: tx.gasUsed,
            price_currency: "USDT",
            created_at: moment.utc().format(),
            paid_at: tx.createDate,
            blockNumber: tx.blockNumber,
            source: "purchase",
            network: tx.network,
            amount: this.web3.utils.fromWei(tx.value, "ether"),
            token_cryptoAmount: cryptoAmount.toFixed(2),
            is_sale: is_sale,
            sale_name: sales.name,
            sale_type: "outside-website"
          };

          const transaction = await this.transactionService.createTransaction(
            createOrder
          );

          if (transaction.is_sale) {
            const updatedSalevalues = {
              $set: {
                user_purchase_token: Number(userPurchaseMid.toFixed(2)),
                remaining_token: Number(remainingMid.toFixed(2)),
              },
            };
            await this.salesModel.updateOne(
              { _id: sales?._id },
              updatedSalevalues
            );
          }
        })
      );
    } catch (error) {
      console.error("Error fetching transaction data:", error);
    }
  }

  private async fetchTransactionsForNetwork(
    networkData: any,
    startBlock: number,
    endBlock: number
  ) {
    const { usdtAddress, apiKey } = networkData;
    const baseUrl = this.getBaseUrlForNetwork(networkData);
    const fromBlockHex = `0x${startBlock.toString(16)}`;
    const toBlockHex = `0x${endBlock.toString(16)}`;

    return axios.get(baseUrl, {
      params: {
        module: "logs",
        action: "getLogs",
        address: usdtAddress,
        fromBlock: fromBlockHex,
        toBlock: toBlockHex,
        topic0:
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer event signature
        topic2: `0x${RECEIVER_ADDRESS.slice(2)
          .toLowerCase()
          .padStart(64, "0")}`,
        apikey: apiKey,
      },
    });
  }

  private async parseLogs(logs: any[], network: string) {
    try {
      return Promise.all(
        logs.map(async (log) => {
          const blockNumber = log.blockNumber;
          const blockHash = log.blockHash;
          const gasPrice = this.web3.utils.hexToNumberString(log.gasPrice);
          const gasUsed = this.web3.utils.hexToNumberString(log.gasUsed);
          const transactionHash = log.transactionHash;
          const { date, method } = await this.getBlockDateAndTransactionDetails(
            blockNumber,
            transactionHash,
            network
          );
        
          if (!this.isWithinLast10Minutes(date)) {
            return null; // Skip transactions that are not within the last 2 hours
          }

          if (
            log.topics &&
            log.topics.length >= 3 &&
            typeof log.topics[1] === "string" &&
            typeof log.topics[2] === "string"
          ) {
            const from = `0x${log.topics[1].slice(26)}`;
            const to = `0x${log.topics[2].slice(26)}`;
            const value = this.web3.utils.hexToNumberString(log.data);
            if (method === "transfer") {
              return {
                from,
                to,
                value,
                blockHash,
                gasPrice,
                gasUsed,
                transactionHash,
                blockNumber,
                createDate: date,
                method,
                network,
              };
            }
          }
          return null; // Return null for non-transfer or invalid logs
        })
      ).then((transactions) => transactions.filter((tx) => tx)); // Filter out undefined or null values
    } catch (error) {
      console.error("Error in parseLogs:", error);
      return []; 
    }
  }
  private async getBlockDateAndTransactionDetails(
    blockNumber: number,
    transactionHash: string,
    network: string
  ) {
    const apiKey = this.getApiKeyForNetwork(network);
    const baseUrl = this.getBaseUrlForNetwork({ network });
  
    try {
      const [blockResponse, transactionResponse] = await Promise.all([
        axios.get(baseUrl, {
          params: {
            module: "proxy",
            action: "eth_getBlockByNumber",
            tag: this.web3.utils.toHex(blockNumber),
            boolean: true,
            apikey: apiKey,
          },
        }),
        axios.get(baseUrl, {
          params: {
            module: "proxy",
            action: "eth_getTransactionByHash",
            txhash: transactionHash,
            apikey: apiKey,
          },
        }),
      ]);
  
      const timestamp = blockResponse.data.result.timestamp;
      const input = transactionResponse.data.result?.input;
  
      if (!input) {
        throw new Error("Transaction input is undefined");
      }
  
      const method = this.decodeMethod(input);
      const formattedDate = moment.unix(timestamp).utc().format();
      return {
        date: formattedDate,
        method: method,
      };
    } catch (error) {
      console.error("Error in getBlockDateAndTransactionDetails:", error);
      throw error; // Re-throw error for handling upstream
    }
  }
  
  private getApiKeyForNetwork(network: string) {
    const apiKeys = {
      FTM: FANTOM_API_KEY,
      ETH: ETHERSCAN_API_KEY,
      BNB: BSCSCAN_API_KEY,
      MATIC: POLYGON_API_KEY,
    };

    return apiKeys[network];
  }

  private getBaseUrlForNetwork(networkData: any) {
    switch (networkData.network) {
      case "ETH":
        return "https://api.etherscan.io/api";
      case "BNB":
        return "https://api.bscscan.com/api";
      case "FTM":
        return "https://api.ftmscan.com/api";
      case "MATIC":
        return "https://api.polygonscan.com/api";
      default:
        throw new Error(`Unsupported network: ${networkData.network}`);
    }
  }

  private decodeMethod(input: string) {
    if (!input || typeof input !== 'string') {
      throw new Error("Invalid input for decodeMethod");
    }
  
    const methodSignature = input.slice(0, 10); // First 4 bytes of the input
    const methods = {
      "0xa9059cbb": "transfer", // ERC20 Transfer
      "0x095ea7b3": "approve", // ERC20 Approve
      "0x23b872dd": "transferFrom",
    };
    return methods[methodSignature] || "unknown";
  }

  private async get10MinuteBlockRange() {
    const currentBlock = await this.web3.eth.getBlockNumber();
    const secondsPerBlock = 15; // Average block time on Ethereum mainnet
    const secondsIn10Minutes = 10 * 60;
    const startBlock = Math.max(
      0,
      currentBlock - Math.floor(secondsIn10Minutes / secondsPerBlock)
    );
    const endBlock = currentBlock; // End at current block
    return { startBlock, endBlock };
  }

  private isWithinLast10Minutes(date: string): boolean {
    const currentTime = moment.utc();
    const transactionTime = moment.utc(date);
    const thirtyMinutesAgo = currentTime.clone().subtract(10, "minutes");
    return transactionTime.isBetween(thirtyMinutesAgo, currentTime);
  }

  //Cron run every 5 minute to get outside website transactions 
  @Cron("*/5 * * * *")
  async handleCron() {
    try {
      await this.fetchTransactionData();
    } catch (error) {
      console.error(error);
    }
  }

  async scheduleTargetTimeCron() {
    try {
      const currentTime = moment.utc();
      const sales = await this.transactionService.getAllSales();
      const preSaleDate = sales[0].start_sale;
      const mainSaleDate = sales[1].start_sale;

      this.scheduledTime = moment.utc(preSaleDate);
      this.scheduledTimeMain = moment.utc(mainSaleDate);

      const tolerance = 1000; // 1 second in milliseconds

      if (Math.abs(currentTime.diff(this.scheduledTime, 'milliseconds')) <= tolerance) {
        const transactions = await this.transactionModel
          .find({ sale_name: "pre-sale", is_sale: false })
          .exec();

        await Promise.all(transactions.map(async transaction => {
          const updatedValues = { $set: { is_sale: true } };
          if (transaction.transactionHash) {
            const currentSales = await this.transactionService.getAllSales();
            let userPurchaseMid = parseFloat(transaction.token_cryptoAmount) + currentSales[0].user_purchase_token;
            let remainingMid = currentSales[0].total_token - userPurchaseMid;

            // Ensure remaining token does not go negative
            if (remainingMid <= 0) {
              remainingMid = 0;
            }

            // Update sales model with cumulative totals
            const updatedSaleValues = {
              $set: {
                user_purchase_token: Number(userPurchaseMid.toFixed(2)),
                remaining_token: Number(remainingMid.toFixed(2)),
              },
            };

            await this.salesModel.updateOne({ _id: currentSales[0]._id }, updatedSaleValues);
            await this.transactionModel.updateOne({ transactionHash: transaction.transactionHash }, updatedValues);
          }
        }));
      }

      if (Math.abs(currentTime.diff(this.scheduledTimeMain, 'milliseconds')) <= tolerance) {
        const transactions = await this.transactionModel
          .find({ sale_name: "main-sale", is_sale: false })
          .exec();
        await Promise.all(transactions.map(async transaction => {
          const updatedValues = { $set: { is_sale: true } };
          if (transaction.transactionHash) {
            const currentSales = await this.transactionService.getAllSales();
            let userPurchaseMid = parseFloat(transaction.token_cryptoAmount) + currentSales[1].user_purchase_token;
            let remainingMid = currentSales[1].total_token - userPurchaseMid;

            // Ensure remaining token does not go negative
            if (remainingMid <= 0) {
              remainingMid = 0;
            }

            // Update sales model with cumulative totals
            const updatedSaleValues = {
              $set: {
                user_purchase_token: Number(userPurchaseMid.toFixed(2)),
                remaining_token: Number(remainingMid.toFixed(2)),
              },
            };

            await this.salesModel.updateOne({ _id: currentSales[1]._id }, updatedSaleValues);
            await this.transactionModel.updateOne({ transactionHash: transaction.transactionHash }, updatedValues);
          }
        }));
      }
    } catch (error) {
      console.error("Error scheduling task:", error);
      throw error;
    }
  }

  scheduleRecurringCheck() {
    // Schedule a job to call scheduleTargetTimeCron every minute
    schedule.scheduleJob('* * * * *', async () => {
      await this.scheduleTargetTimeCron();
    });
  }
}
