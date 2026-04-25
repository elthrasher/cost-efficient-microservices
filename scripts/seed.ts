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

const products = [
  {
    productId: "prod-1",
    name: "Wireless Headphones",
    price: 79.99,
    description: "Bluetooth over-ear headphones with noise cancellation",
    category: "electronics",
  },
  {
    productId: "prod-2",
    name: "USB-C Hub",
    price: 49.99,
    description: "7-in-1 USB-C hub with HDMI, USB-A, and SD card reader",
    category: "electronics",
  },
  {
    productId: "prod-3",
    name: "Mechanical Keyboard",
    price: 129.99,
    description: "Cherry MX Brown switches, RGB backlit",
    category: "electronics",
  },
  {
    productId: "prod-4",
    name: "Desk Lamp",
    price: 34.99,
    description:
      "LED desk lamp with adjustable brightness and color temperature",
    category: "office",
  },
  {
    productId: "prod-5",
    name: "Notebook Pack",
    price: 12.99,
    description: "3-pack of dotted grid notebooks, A5 size",
    category: "office",
  },
  {
    productId: "prod-6",
    name: "Coffee Mug",
    price: 14.99,
    description: "Insulated stainless steel mug, 16oz",
    category: "kitchen",
  },
  {
    productId: "prod-7",
    name: "Standing Desk Mat",
    price: 44.99,
    description: "Anti-fatigue mat for standing desks",
    category: "office",
  },
  {
    productId: "prod-8",
    name: "Webcam HD",
    price: 59.99,
    description: "1080p webcam with built-in microphone",
    category: "electronics",
  },
];

const items = products.flatMap((product) => [
  // Product record
  {
    PutRequest: {
      Item: {
        PK: `PRODUCT#${product.productId}`,
        SK: `PRODUCT#${product.productId}`,
        ...product,
      },
    },
  },
  // Inventory record
  {
    PutRequest: {
      Item: {
        PK: `PRODUCT#${product.productId}`,
        SK: "INVENTORY",
        productId: product.productId,
        quantity: 100,
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
