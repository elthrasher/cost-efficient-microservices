import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  StateMachine,
  Pass,
  QueryLanguage,
  ProvideItems,
  Choice,
  Condition,
  Parallel,
  IChainable,
  DefinitionBody,
  StateMachineType,
  LogLevel,
  Map,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

interface OrderWorkflowProps {
  validateOrderFn: IFunction;
  reserveInventoryFn: IFunction;
  releaseInventoryFn: IFunction;
  processPaymentFn: IFunction;
  saveOrderFn: IFunction;
}

export class OrderWorkflow extends Construct {
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: OrderWorkflowProps) {
    super(scope, id);

    // --- Error response helpers ---
    // Instead of Fail states that expose internals, return clean error objects
    // and let the workflow succeed so API Gateway returns 200 with error details.

    const formatValidationError = new Pass(this, "FormatValidationError", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        status: "error",
        error: "validation_error",
        message:
          "Order validation failed. Please check your items and payment method.",
      },
    });

    const formatInventoryError = new Pass(this, "FormatInventoryError", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        status: "error",
        error: "inventory_error",
        message:
          "One or more items are out of stock. Please adjust quantities and try again.",
      },
    });

    const formatPaymentError = new Pass(this, "FormatPaymentError", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        status: "error",
        error: "payment_error",
        message:
          "Payment processing failed. Please try again or use a different payment method.",
      },
    });

    const formatInvalidMethodError = new Pass(
      this,
      "FormatInvalidMethodError",
      {
        queryLanguage: QueryLanguage.JSONATA,
        outputs: {
          status: "error",
          error: "validation_error",
          message:
            "{% 'Unsupported payment method. Must be one of: stripe, paypal, applepay' %}",
        },
      },
    );

    // --- Step 1: Transform incoming request (JSONata) ---
    // Custom AwsIntegration passes the request body directly as the state machine input
    // (no body/querystring/path wrapper like StepFunctionsIntegration)
    const transformRequest = new Pass(this, "TransformRequest", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: "{% $merge([{'orderId': $uuid()}, $states.input]) %}",
    });

    const formatMissingFieldsError = new Pass(
      this,
      "FormatMissingFieldsError",
      {
        queryLanguage: QueryLanguage.JSONATA,
        outputs: {
          status: "error",
          error: "validation_error",
          message:
            "Missing required fields. Please provide customerId, paymentMethod, and items.",
        },
      },
    );

    const validateRequiredFields = new Choice(this, "ValidateRequiredFields", {
      queryLanguage: QueryLanguage.JSONATA,
    });

    // --- Step 2: Validate order (Lambda) ---
    const validateOrder = new LambdaInvoke(this, "ValidateOrder", {
      lambdaFunction: props.validateOrderFn,
      queryLanguage: QueryLanguage.JSONATA,
      assign: {
        order:
          "{% $merge([$states.result.Payload, {'orderId': $states.input.orderId}, $exists($states.input.simulateDecline) ? {'simulateDecline': $states.input.simulateDecline} : {}]) %}",
      },
      outputs: "{% $states.input %}",
    });
    validateOrder.addCatch(formatValidationError, {
      errors: ["States.ALL"],
    });

    // Wire required fields validation (after validateOrder is declared)
    validateRequiredFields
      .when(
        Condition.jsonata(
          "{% $not($exists($states.input.customerId)) or $not($exists($states.input.paymentMethod)) or $not($exists($states.input.items)) %}",
        ),
        formatMissingFieldsError,
      )
      .otherwise(validateOrder);

    // --- Step 3: Reserve inventory (Map — parallel per item) ---
    // Tolerate all failures so we get results for every item.
    // Successfully reserved items return {productId, quantity, reserved: true}.
    // Failed items are caught and return {reserved: false}.
    // After the Map, we use JSONata to check for failures and only release reserved items.
    const reserveInventory = new Map(this, "ReserveInventory", {
      queryLanguage: QueryLanguage.JSONATA,
      items: ProvideItems.jsonata("{% $order.items %}"),
      maxConcurrency: 0,
      assign: {
        order: "{% $order %}",
        reservedItems:
          "{% $count($states.result[reserved = true]) > 0 ? $states.result[reserved = true] : [] %}",
      },
      outputs: "{% $order %}",
    });

    const reserveOneItem = new LambdaInvoke(this, "ReserveOneItem", {
      lambdaFunction: props.reserveInventoryFn,
      queryLanguage: QueryLanguage.JSONATA,
      outputs: "{% $states.result.Payload %}",
    });

    // Catch reservation failures within the Map — return a marker instead of failing
    const reservationFailed = new Pass(this, "ReservationFailed", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        reserved: false,
      },
    });
    reserveOneItem.addCatch(reservationFailed, { errors: ["States.ALL"] });

    reserveInventory.itemProcessor(reserveOneItem);

    // Catch unexpected Map-level errors (not individual item failures)
    reserveInventory.addCatch(formatInventoryError, {
      errors: ["States.ALL"],
    });

    // After the Map: check if any reservations failed
    const checkReservations = new Choice(this, "CheckReservations", {
      queryLanguage: QueryLanguage.JSONATA,
    });

    // --- Compensation: Release only reserved items ---
    const prepareReleaseOnReserveFail = new Pass(
      this,
      "PrepareReleaseOnReserveFail",
      {
        queryLanguage: QueryLanguage.JSONATA,
        outputs: { items: "{% $reservedItems %}" },
      },
    );

    const releaseInventoryOnReserveFail = new LambdaInvoke(
      this,
      "ReleaseInventoryOnReserveFail",
      {
        lambdaFunction: props.releaseInventoryFn,
        queryLanguage: QueryLanguage.JSONATA,
        outputs: "{% $states.result.Payload %}",
      },
    );

    const prepareReleaseOnPaymentFail = new Pass(
      this,
      "PrepareReleaseOnPaymentFail",
      {
        queryLanguage: QueryLanguage.JSONATA,
        outputs: { items: "{% $reservedItems %}" },
      },
    );

    const releaseInventoryOnPaymentFail = new LambdaInvoke(
      this,
      "ReleaseInventoryOnPaymentFail",
      {
        lambdaFunction: props.releaseInventoryFn,
        queryLanguage: QueryLanguage.JSONATA,
        outputs: "{% $states.result.Payload %}",
      },
    );

    // Compensation chains
    const compensateInventoryAndFail = prepareReleaseOnPaymentFail
      .next(releaseInventoryOnPaymentFail)
      .next(formatPaymentError);

    // If any reservation failed: release the ones that succeeded, then error
    const handleReservationFailure = prepareReleaseOnReserveFail
      .next(releaseInventoryOnReserveFail)
      .next(formatInventoryError);

    checkReservations.when(
      Condition.jsonata(
        "{% $count($states.input.items) != $count($reservedItems) %}",
      ),
      handleReservationFailure as unknown as IChainable,
    );

    // --- Step 4: Payment routing (Choice + JSONata transforms) ---
    const buildStripeRequest = new Pass(this, "BuildStripeRequest", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        orderId: "{% $states.input.orderId %}",
        processor: "stripe",
        amount: "{% $states.input.total %}",
        customerId: "{% $states.input.customerId %}",
        simulateDecline:
          "{% $exists($states.input.simulateDecline) ? $states.input.simulateDecline : false %}",
        metadata:
          "{% { 'itemCount': $count($states.input.items), 'currency': 'usd' } %}",
      },
    });

    const buildPayPalRequest = new Pass(this, "BuildPayPalRequest", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        orderId: "{% $states.input.orderId %}",
        processor: "paypal",
        amount: "{% $states.input.total %}",
        customerId: "{% $states.input.customerId %}",
        simulateDecline:
          "{% $exists($states.input.simulateDecline) ? $states.input.simulateDecline : false %}",
        metadata:
          "{% { 'itemCount': $count($states.input.items), 'description': 'Order ' & $states.input.orderId } %}",
      },
    });

    const buildApplePayRequest = new Pass(this, "BuildApplePayRequest", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        orderId: "{% $states.input.orderId %}",
        processor: "applepay",
        amount: "{% $states.input.total %}",
        customerId: "{% $states.input.customerId %}",
        simulateDecline:
          "{% $exists($states.input.simulateDecline) ? $states.input.simulateDecline : false %}",
        metadata:
          "{% { 'itemCount': $count($states.input.items), 'merchantId': 'merchant.orderprocessor' } %}",
      },
    });

    // Payment Lambda invocations
    const chargeStripe = new LambdaInvoke(this, "ChargeStripe", {
      lambdaFunction: props.processPaymentFn,
      queryLanguage: QueryLanguage.JSONATA,
      assign: { payment: "{% $states.result.Payload %}" },
      outputs: "{% $states.input %}",
      retryOnServiceExceptions: false,
    });
    chargeStripe.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 2,
      backoffRate: 2,
      interval: Duration.seconds(1),
    });
    chargeStripe.addCatch(compensateInventoryAndFail, {
      errors: ["States.ALL"],
    });

    const chargePayPal = new LambdaInvoke(this, "ChargePayPal", {
      lambdaFunction: props.processPaymentFn,
      queryLanguage: QueryLanguage.JSONATA,
      assign: { payment: "{% $states.result.Payload %}" },
      outputs: "{% $states.input %}",
      retryOnServiceExceptions: false,
    });
    chargePayPal.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 2,
      backoffRate: 2,
      interval: Duration.seconds(1),
    });
    chargePayPal.addCatch(compensateInventoryAndFail, {
      errors: ["States.ALL"],
    });

    const chargeApplePay = new LambdaInvoke(this, "ChargeApplePay", {
      lambdaFunction: props.processPaymentFn,
      queryLanguage: QueryLanguage.JSONATA,
      assign: { payment: "{% $states.result.Payload %}" },
      outputs: "{% $states.input %}",
      retryOnServiceExceptions: false,
    });
    chargeApplePay.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 2,
      backoffRate: 2,
      interval: Duration.seconds(1),
    });
    chargeApplePay.addCatch(compensateInventoryAndFail, {
      errors: ["States.ALL"],
    });

    buildStripeRequest.next(chargeStripe);
    buildPayPalRequest.next(chargePayPal);
    buildApplePayRequest.next(chargeApplePay);

    const routePayment = new Choice(this, "RoutePayment", {
      queryLanguage: QueryLanguage.JSONATA,
    });

    routePayment
      .when(
        Condition.jsonata("{% $states.input.paymentMethod = 'stripe' %}"),
        buildStripeRequest,
      )
      .when(
        Condition.jsonata("{% $states.input.paymentMethod = 'paypal' %}"),
        buildPayPalRequest,
      )
      .when(
        Condition.jsonata("{% $states.input.paymentMethod = 'applepay' %}"),
        buildApplePayRequest,
      )
      .otherwise(formatInvalidMethodError);

    // Wire checkReservations → routePayment (after routePayment is declared)
    checkReservations.otherwise(routePayment);

    // --- Step 5: Post-payment parallel steps ---
    const mergePaymentResult = new Pass(this, "MergePaymentResult", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        orderId: "{% $order.orderId %}",
        customerId: "{% $order.customerId %}",
        paymentMethod: "{% $order.paymentMethod %}",
        items: "{% $order.items %}",
        total: "{% $order.total %}",
        payment: "{% $payment %}",
      },
    });

    const saveOrder = new LambdaInvoke(this, "SaveOrder", {
      lambdaFunction: props.saveOrderFn,
      queryLanguage: QueryLanguage.JSONATA,
      outputs: "{% $states.result.Payload %}",
    });

    const sendConfirmation = new Pass(this, "SendConfirmation", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        notification:
          "{% 'Order ' & $states.input.orderId & ' confirmed for customer ' & $states.input.customerId & '. Charged $' & $string($states.input.payment.amount) & ' via ' & $states.input.payment.processor %}",
        timestamp: "{% $now() %}",
        type: "order_confirmation",
      },
    });

    const updateMetrics = new Pass(this, "UpdateMetrics", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        metric: "order_completed",
        processor: "{% $states.input.payment.processor %}",
        amount: "{% $states.input.payment.amount %}",
        itemCount: "{% $count($states.input.items) %}",
        timestamp: "{% $now() %}",
      },
    });

    const postPaymentSteps = new Parallel(this, "PostPaymentSteps", {
      queryLanguage: QueryLanguage.JSONATA,
    });
    postPaymentSteps.branch(saveOrder);
    postPaymentSteps.branch(sendConfirmation);
    postPaymentSteps.branch(updateMetrics);

    // --- Step 6: Transform final response (JSONata) ---
    const transformResponse = new Pass(this, "TransformResponse", {
      queryLanguage: QueryLanguage.JSONATA,
      outputs: {
        status: "success",
        orderId: "{% $states.input[0].orderId %}",
        message:
          "{% 'Order processed successfully via ' & $states.input[1].type %}",
      },
    });

    postPaymentSteps.next(transformResponse);

    chargeStripe.next(mergePaymentResult);
    chargePayPal.next(mergePaymentResult);
    chargeApplePay.next(mergePaymentResult);

    mergePaymentResult.next(postPaymentSteps);

    // --- Assemble the chain ---
    // validateRequiredFields routes to validateOrder on success (set in Choice above)
    validateOrder.next(reserveInventory);
    reserveInventory.next(checkReservations);

    const definition = transformRequest.next(validateRequiredFields);

    // --- State Machine ---
    this.stateMachine = new StateMachine(this, "OrderStateMachine", {
      definitionBody: DefinitionBody.fromChainable(definition),
      stateMachineName: "order-workflow",
      stateMachineType: StateMachineType.EXPRESS,
      timeout: Duration.seconds(30),
      tracingEnabled: true,
      logs: {
        destination: new LogGroup(this, "OrderWorkflowLogs", {
          retention: RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    });
  }
}
