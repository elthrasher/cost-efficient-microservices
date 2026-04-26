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
  AwsIntegration,
  PassthroughBehavior,
  StepFunctionsIntegration,
} from "aws-cdk-lib/aws-apigateway";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

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

    // POST /orders → Step Functions (sync express execution) with VTL response mapping
    const ordersResource = api.root.addResource("orders");

    // VTL request template: pass the request body as the state machine input
    const requestTemplate = [
      `#set($customerId = $util.parseJson($input.body).get('customerId'))`,
      `{`,
      `  "input": "$util.escapeJavaScript($input.body).replaceAll("\\\\'", "'")",`,
      `  "name": "$util.escapeJavaScript($customerId)",`,
      `  "stateMachineArn": "${workflow.stateMachine.stateMachineArn}"`,
      `}`,
    ].join("\n");

    // VTL response template for successful execution (HTTP 200 from SFN API)
    // StartSyncExecution returns { status, output, ... } where output is a JSON string.
    // Check the output for error status and override HTTP status to 400.
    const successResponseTemplate = [
      `#set($sfnOutput = $input.path('$.output'))`,
      `#if($sfnOutput.toString().contains('"status":"error"'))`,
      `#set($context.responseOverride.status = 400)`,
      `#end`,
      `$sfnOutput`,
    ].join("\n");

    // VTL response template for failed execution (Step Functions API error)
    const errorResponseTemplate = JSON.stringify({
      status: "error",
      error: "internal_error",
      message: "An unexpected error occurred. Please try again.",
    });

    const sfnIntegration = StepFunctionsIntegration.startExecution(
      workflow.stateMachine,
      {
        integrationResponses: [
          {
            // Successful Step Functions execution (HTTP 200 from SFN API)
            statusCode: "200",
            responseTemplates: {
              "application/json": successResponseTemplate,
            },
          },
          {
            // Step Functions API errors (throttle, invalid ARN, etc.)
            selectionPattern: "4\\d{2}",
            statusCode: "400",
            responseTemplates: {
              "application/json": errorResponseTemplate,
            },
          },
          {
            // Step Functions internal errors
            selectionPattern: "5\\d{2}",
            statusCode: "500",
            responseTemplates: {
              "application/json": errorResponseTemplate,
            },
          },
        ],
        requestTemplates: {
          "application/json": requestTemplate,
        },
        useDefaultMethodResponses: false,
      },
    );

    ordersResource.addMethod("POST", sfnIntegration, {
      methodResponses: [
        { statusCode: "200" },
        { statusCode: "400" },
        { statusCode: "500" },
      ],
    });

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
