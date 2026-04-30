# Serverless Order Processor — Design Document

A sample project demonstrating cost-efficient serverless microservices using AWS Step Functions, API Gateway, DynamoDB, and Lambda. Built with AWS CDK and TypeScript.

## Architecture Overview

An order processing pipeline that validates orders, reserves inventory in parallel across line items, routes payment to the customer's chosen processor, and handles compensation on failure — all orchestrated by an Express Step Function.

### Why This Stack

- **Express Step Functions** — orchestrate multi-step workflows without glue code, pay per execution
- **JSONata** — transform data between steps without Lambda invocations, reducing cost and latency
- **DynamoDB** — single-digit-millisecond reads/writes, pay-per-request pricing
- **API Gateway** — managed REST interface with request validation
- **Lambda** — only used where real compute is needed (validation, payments, DB writes)

## Workflow

```
POST /orders
  → Transform request (JSONata — reshape API event into internal order format)
  → ValidateOrder (Lambda — check products exist, prices match)
  → ReserveInventory (Map state — parallel conditional writes per item)
      Catch → Fail with "out of stock" details
  → Route payment by method (Choice state)
      ├── Stripe  → Transform (JSONata) → ProcessPayment (Lambda)
      ├── PayPal  → Transform (JSONata) → ProcessPayment (Lambda)
      └── ApplePay → Transform (JSONata) → ProcessPayment (Lambda)
      Each path: Retry (transient errors) → Catch → ReleaseInventory → Fail
  → Parallel (best-effort)
      ├── SaveOrder (Lambda)
      ├── SendConfirmation (JSONata — structured log)
      └── UpdateMetrics (JSONata — structured log)
  → Transform response (JSONata)
  → Success

Compensation on payment failure:
  ReleaseInventory (Lambda — undo all reservations) → Fail with error details
```

### Parallel Patterns

Two distinct uses of parallelism:

1. **Inventory reservation (Map state)** — Each line item is reserved independently via a conditional DynamoDB write. If any item fails (insufficient stock), the catch handler releases all previously reserved items. This demonstrates Map state with error handling and compensation.

2. **Post-payment steps (Parallel state)** — Save order, send confirmation, and update metrics run concurrently. These are best-effort; a failure here doesn't roll back the order.

### Payment Routing

The customer selects a payment method (Stripe, PayPal, or Apple Pay) at order time. A Choice state routes to the appropriate processor path. Each path:
- Uses a JSONata Pass state to transform the order into the processor-specific request format
- Invokes the same Lambda function with different configuration (processor name, API format)
- Has its own Retry policy (for transient gateway errors) and Catch (for hard failures)
- On hard failure: triggers compensation (release inventory) and returns an error

This is realistic — customers choose how to pay, and each processor has its own API contract.

### JSONata Usage

| Location | Purpose |
|---|---|
| Request ingress | Transform API Gateway event → internal order format |
| Pre-inventory | Extract items array for Map state iteration |
| Pre-payment (per processor) | Reshape order into Stripe / PayPal / Apple Pay request format |
| Post-parallel | Merge parallel step results into single response |
| Response egress | Shape the final API response returned to caller |

## API Surface

| Method | Path | Description |
|---|---|---|
| POST | /orders | Submit a new order (triggers Step Function) |
| GET | /orders/{id} | Get order status and details |
| GET | /products | List available products (seed data) |

### POST /orders Request Body

```json
{
  "customerId": "customer-123",
  "paymentMethod": "stripe",
  "items": [
    { "productId": "prod-1", "quantity": 2 },
    { "productId": "prod-3", "quantity": 1 }
  ]
}
```

## DynamoDB Single-Table Design

| Entity | PK | SK | Key Attributes |
|---|---|---|---|
| Product | `PRODUCT#<id>` | `PRODUCT#<id>` | name, price, description, category |
| Inventory | `PRODUCT#<id>` | `INVENTORY` | quantity (atomic counter) |
| Order | `ORDER#<id>` | `ORDER#<id>` | status, customerId, total, paymentMethod, paymentProcessor, createdAt |
| OrderItem | `ORDER#<id>` | `ITEM#<productId>` | productId, name, price, quantity |

### Access Patterns

- **Get product + inventory** — Query PK = `PRODUCT#<id>` (returns both records)
- **Get order + items** — Query PK = `ORDER#<id>` (returns order + all line items)
- **Reserve inventory** — ConditionExpression: `quantity >= :requested` with atomic decrement
- **Release inventory** — Atomic increment (compensation)
- **List products** — Scan with filter (acceptable for small catalog; GSI if needed)

## Project Structure

```
serverless-order-processor/
├── bin/
│   └── app.ts                          # CDK app entry
├── lib/
│   ├── order-processor-stack.ts        # CDK stack (infra + state machine)
│   └── order-workflow.ts               # Step Functions definition (CDK constructs)
├── functions/
│   ├── validate-order.ts               # Check products exist, prices match
│   ├── reserve-inventory.ts            # Reserve single item (used by Map state)
│   ├── release-inventory.ts            # Compensation: undo all reservations
│   ├── process-payment.ts              # Route to processor by config
│   ├── save-order.ts                   # Write final order to DynamoDB
│   ├── get-order.ts                    # GET /orders/{id}
│   └── list-products.ts               # GET /products
├── scripts/
│   └── seed.ts                         # Seed products + inventory
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

## State Machine (CDK Constructs)

The workflow is defined entirely in TypeScript using `aws-cdk-lib/aws-stepfunctions` and `aws-cdk-lib/aws-stepfunctions-tasks`. This gives us type safety, IDE support, and keeps the workflow definition co-located with the infrastructure.

Key constructs used:
- **LambdaInvoke** — compute steps (validation, payment, DB writes)
- **Pass** with JSONata — data transformation between steps
- **Map** — parallel inventory reservation per line item
- **Parallel** — concurrent post-payment steps
- **Choice** — route to payment processor by customer selection
- **Retry/Catch** — transient error retry + hard failure compensation

## Error Handling Scenarios

| Scenario | Behavior |
|---|---|
| Missing required fields | Choice state catches nulls → clean validation error |
| Item not found / price mismatch | Catch on ValidateOrder → clean validation error |
| Insufficient inventory (one item) | Catch on Map → release already-reserved items → clean inventory error |
| Payment gateway transient error | Retry with backoff (up to 3 attempts) |
| Payment hard failure (declined, etc.) | Catch → release all inventory → clean payment error |
| Post-payment step fails | Order still succeeds (best-effort) |

All error paths return clean JSON responses (`{status, error, message}`) without exposing implementation details.

## Payment Processor Simulation

All three processors use the same Lambda function with different configuration passed via the JSONata transform. A `FAILURE_RATE` environment variable (0.0–1.0) controls how often the function "fails," making it easy to demo error handling. The function also accepts a `simulateDecline` flag in the request for deterministic testing.

## Seed Data

The seed script populates the table with sample products and inventory:
- 5–10 products across a couple of categories
- Inventory quantities set high enough for repeated testing
- Idempotent (safe to run multiple times)

## Test Scenarios

Curl commands / scripts to exercise:
1. **Happy path** — order with Stripe, all items in stock, payment succeeds
2. **Different processor** — order with PayPal or Apple Pay
3. **Payment failure** — force decline, verify inventory is released
4. **Validation failure** — invalid product ID or wrong price
5. **Inventory failure** — order quantity exceeds stock, verify partial reservations are released
6. **Transient retry** — payment retries then succeeds (visible in Step Functions execution history)
