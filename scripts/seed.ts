import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const tableName = process.env.TABLE_NAME;
if (!tableName) {
  console.error("Usage: TABLE_NAME=<table-name> npm run seed");
  process.exit(1);
}

const TABLE_NAME: string = tableName;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Scenario test products — low inventory for testing error paths
const scenarioProducts = [
  {
    productId: "prod-1",
    name: "Wireless Headphones",
    price: 79.99,
    description: "Bluetooth over-ear headphones with noise cancellation",
    category: "electronics",
    quantity: 100,
  },
  {
    productId: "prod-2",
    name: "USB-C Hub",
    price: 49.99,
    description: "7-in-1 USB-C hub with HDMI, USB-A, and SD card reader",
    category: "electronics",
    quantity: 100,
  },
  {
    productId: "prod-3",
    name: "Mechanical Keyboard",
    price: 129.99,
    description: "Cherry MX Brown switches, RGB backlit",
    category: "electronics",
    quantity: 100,
  },
  {
    productId: "prod-4",
    name: "Desk Lamp",
    price: 34.99,
    description:
      "LED desk lamp with adjustable brightness and color temperature",
    category: "office",
    quantity: 100,
  },
  {
    productId: "prod-5",
    name: "Notebook Pack",
    price: 12.99,
    description: "3-pack of dotted grid notebooks, A5 size",
    category: "office",
    quantity: 100,
  },
  {
    productId: "prod-6",
    name: "Coffee Mug",
    price: 14.99,
    description: "Insulated stainless steel mug, 16oz",
    category: "kitchen",
    quantity: 100,
  },
  {
    productId: "prod-7",
    name: "Standing Desk Mat",
    price: 44.99,
    description: "Anti-fatigue mat for standing desks",
    category: "office",
    quantity: 100,
  },
  {
    productId: "prod-8",
    name: "Webcam HD",
    price: 59.99,
    description: "1080p webcam with built-in microphone",
    category: "electronics",
    quantity: 100,
  },
];

// Load test products — high inventory so the load test doesn't exhaust stock
const loadTestProducts = [
  {
    productId: "load-1",
    name: "Load Test Widget A",
    price: 9.99,
    description: "Load test product",
    category: "electronics",
    quantity: 1000000,
  },
  {
    productId: "load-2",
    name: "Load Test Widget B",
    price: 19.99,
    description: "Load test product",
    category: "office",
    quantity: 1000000,
  },
  {
    productId: "load-3",
    name: "Load Test Widget C",
    price: 29.99,
    description: "Load test product",
    category: "kitchen",
    quantity: 1000000,
  },
];

const products = [...scenarioProducts, ...loadTestProducts];

const items = products.flatMap((product) => [
  {
    PutRequest: {
      Item: {
        PK: `PRODUCT#${product.productId}`,
        SK: `PRODUCT#${product.productId}`,
        productId: product.productId,
        name: product.name,
        price: product.price,
        description: product.description,
        category: product.category,
      },
    },
  },
  {
    PutRequest: {
      Item: {
        PK: `PRODUCT#${product.productId}`,
        SK: "INVENTORY",
        productId: product.productId,
        quantity: product.quantity,
      },
    },
  },
]);

async function seed() {
  // BatchWrite supports max 25 items per call
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch,
        },
      }),
    );
  }

  console.log(
    `Seeded ${products.length} products with inventory to table ${TABLE_NAME}`,
  );
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
