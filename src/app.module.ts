import { Module, MiddlewareConsumer } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { UsersController } from "./controller/user/users.controller";
import { AuthController } from "./controller/auth/auth.controller";
import { UserSchema } from "./schema/user.schema";
import { UserService } from "./service/user/users.service";
import { AuthenticateMiddleware } from "./middleware/authenticate.middleware";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { TokenService } from "./service/token/token.service";
import { TokenSchema } from "./schema/token.schema";
import { SalesSchema } from "./schema/sales.schema";
import { TransactionsController } from "./controller/transaction/transactions.controller";
import { TransactionsService } from "./service/transaction/transactions.service";
import { TransactionSchema } from "./schema/transaction.schema";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { CustomThrottleMiddleware } from "./middleware/custom-throttle.middleware";
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    MongooseModule.forRoot("mongodb://127.0.0.1:27017/ico"),
    MongooseModule.forFeature([{ name: "user", schema: UserSchema }]),
    MongooseModule.forFeature([{ name: "sales", schema: SalesSchema }]),
    MongooseModule.forFeature([{ name: "token", schema: TokenSchema }]),
    MongooseModule.forFeature([
      { name: "transaction", schema: TransactionSchema },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRoot({
      ttl: 5,
      limit: 5,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AppController,
    UsersController,
    AuthController,
    TransactionsController,
  ],
  providers: [
    AppService,
    UserService,
    TokenService,
    TransactionsService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})

export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthenticateMiddleware).forRoutes("/users", "/transactions");
    consumer.apply(CustomThrottleMiddleware).forRoutes(
      "/users/updateAccountSettings",
      "/users/generate2FASecret",
      "/users/updateKyc",
      "/users/validateTOTP",
      "/transactions/createOrder",
      "/users/verify"
    );
  }
}
