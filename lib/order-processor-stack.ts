import { Construct } from "constructs";
import { OrderWorkflow } from "./order-workflow";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import path from "path";
import {
  NodejsFunction,
  NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  LambdaIntegration,
  RestApi,
  StepFunctionsIntegration,
} from "aws-cdk-lib/aws-apigateway";

export class OrderProcessorStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- DynamoDB single table ---
    const table = new Table(this, "OrderTable", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      tableName: "order-processor-table",
    });

    // --- Shared Lambda props ---
    const sharedFnProps: Partial<NodejsFunctionProps> = {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

    // --- Lambda functions ---
    const validateOrderFn = new NodejsFunction(this, "ValidateOrderFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/validate-order.ts"),
      functionName: "order-processor-validate-order",
    });

    const reserveInventoryFn = new NodejsFunction(this, "ReserveInventoryFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/reserve-inventory.ts"),
      functionName: "order-processor-reserve-inventory",
    });

    const releaseInventoryFn = new NodejsFunction(this, "ReleaseInventoryFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/release-inventory.ts"),
      functionName: "order-processor-release-inventory",
    });

    const processPaymentFn = new NodejsFunction(this, "ProcessPaymentFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/process-payment.ts"),
      functionName: "order-processor-process-payment",
      environment: {
        ...sharedFnProps.environment!,
        FAILURE_RATE: "0.0",
      },
    });

    const refundPaymentFn = new NodejsFunction(this, "RefundPaymentFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/refund-payment.ts"),
      functionName: "order-processor-refund-payment",
    });

    const saveOrderFn = new NodejsFunction(this, "SaveOrderFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/save-order.ts"),
      functionName: "order-processor-save-order",
    });

    const getOrderFn = new NodejsFunction(this, "GetOrderFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/get-order.ts"),
      functionName: "order-processor-get-order",
    });

    const listProductsFn = new NodejsFunction(this, "ListProductsFn", {
      ...sharedFnProps,
      entry: path.join(__dirname, "../functions/list-products.ts"),
      functionName: "order-processor-list-products",
    });

    // --- DynamoDB permissions ---
    table.grantReadData(validateOrderFn);
    table.grantReadWriteData(reserveInventoryFn);
    table.grantReadWriteData(releaseInventoryFn);
    table.grantReadWriteData(saveOrderFn);
    table.grantReadData(getOrderFn);
    table.grantReadData(listProductsFn);

    // --- Step Functions workflow ---
    const workflow = new OrderWorkflow(this, "OrderWorkflow", {
      validateOrderFn,
      reserveInventoryFn,
      releaseInventoryFn,
      processPaymentFn,
      saveOrderFn,
    });

    // --- API Gateway ---
    const api = new RestApi(this, "OrderApi", {
      restApiName: "Order Processor API",
      description: "Serverless order processing API",
      deployOptions: {
        stageName: "prod",
        tracingEnabled: true,
      },
    });

    // POST /orders → Step Functions (sync express execution)
    const ordersResource = api.root.addResource("orders");
    const sfnIntegration = StepFunctionsIntegration.startExecution(
      workflow.stateMachine,
      { useDefaultMethodResponses: true },
    );
    ordersResource.addMethod("POST", sfnIntegration);

    // GET /orders/{id}
    const orderByIdResource = ordersResource.addResource("{id}");
    orderByIdResource.addMethod("GET", new LambdaIntegration(getOrderFn));

    // GET /products
    const productsResource = api.root.addResource("products");
    productsResource.addMethod("GET", new LambdaIntegration(listProductsFn));

    // --- Outputs ---
    new CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new CfnOutput(this, "TableName", {
      value: table.tableName,
      description: "DynamoDB table name",
    });

    new CfnOutput(this, "StateMachineArn", {
      value: workflow.stateMachine.stateMachineArn,
      description: "Step Functions state machine ARN",
    });
  }
}
