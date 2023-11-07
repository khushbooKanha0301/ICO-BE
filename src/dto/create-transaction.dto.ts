import { IsArray, IsOptional, IsString } from "class-validator";
export class CreateTransactionDto {
	@IsOptional()
	tran_id: number;
	
	@IsOptional()
	@IsString()
	status: string;
	
	@IsOptional()
	@IsString()
	title: string;

	@IsOptional()
	do_not_convert: boolean;

	@IsOptional()
	@IsString()
	orderable_type: string;

	@IsOptional()
	orderable_id: number;

	@IsOptional()
	@IsString()
	price_currency: string;

	@IsOptional()
	@IsString()
	price_amount: string;

	@IsOptional()
	lightning_network: boolean;

	@IsOptional()
	@IsString()
	receive_currency: string;

	@IsOptional()
	receive_amount: string;
	
	@IsOptional()
	@IsString()
	created_at: string;

	@IsOptional()
	@IsString()
	order_id: string;

	@IsOptional()
    @IsString()
    payment_url: string;

	@IsOptional()
    underpaid_amount: number;

	@IsOptional()
	@IsString()
	overpaid_amount: string;

	@IsOptional()
	is_refundable: boolean;

    @IsOptional()
    @IsArray()
	refunds: string[];

    @IsOptional()
	@IsArray()
	voids: string[];

    @IsOptional()
	@IsArray()
	fees: string[];

    @IsOptional()
	@IsString()
	token: string;

	@IsOptional()
	@IsString()
	transaction_status: string;

	@IsOptional()
	@IsString()
	wallet_address: string;

	@IsOptional()
	@IsString()
	token_cryptoAmount: string;

	@IsOptional()
	@IsString()
	source: string;

}