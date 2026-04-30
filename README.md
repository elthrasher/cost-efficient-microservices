# Serverless Order Processor

A cost-efficient serverless order processing pipeline demonstrating AWS Step Functions (Express), API Gateway, DynamoDB, and Lambda with JSONata transformations.

![Code Blog](./Code_Blog.png)

## Architecture

- **Express Step Function** orchestrates the order workflow
- **JSONata** transforms data between steps (no Lambda needed for reshaping)
- **DynamoDB** single-table design for products, inventory, and orders
- **API Gateway** with synchronous Step Functions integration
- **Lambda** functions only where compute is required

## Workflow

1. Transform incoming request (JSONata)
2. Validate required fields (Choice state)
3. Validate order — check products exist, compute totals (Lambda)
4. Reserve inventory — parallel conditional writes per item (Map state)
5. Route payment by method — Stripe / PayPal / Apple Pay (Choice state + JSONata transforms)
6. Post-payment — save order, log confirmation, log metrics (Parallel state)
7. Transform response (JSONata)

Error handling: inventory and payment failures trigger compensation (release inventory) and return clean error responses.

## Prerequisites

- Node.js 24+
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS credentials configured

## Quick Start

```bash
npm install
npm run setup    # deploys, seeds data, writes .env
```

## Manual Deploy

```bash
npx cdk deploy
TABLE_NAME=<table-name-from-output> npm run seed
```

## Test

```bash
npm run test:scenarios
```

## Load Test

Requires [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/):

```bash
# macOS
brew install k6

# Run the load test (reads API_URL from .env)
npm run test:load
```

The load test ramps from 0 to 200 concurrent virtual users over 35 seconds, generating ~10,000 requests. It uses dedicated high-inventory products (`load-1`, `load-2`, `load-3`) so it won't interfere with scenario test data.

## API

```bash
API_URL=<api-url-from-output>

# List products
curl $API_URL/products

# Place an order
curl -X POST $API_URL/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-123",
    "paymentMethod": "stripe",
    "items": [
      { "productId": "prod-1", "quantity": 2 },
      { "productId": "prod-5", "quantity": 1 }
    ]
  }'

# Force payment decline
curl -X POST $API_URL/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-123",
    "paymentMethod": "stripe",
    "simulateDecline": true,
    "items": [{ "productId": "prod-1", "quantity": 1 }]
  }'

# Get order status
curl $API_URL/orders/{orderId}
```

## Cleanup

```bash
npx cdk destroy
```
