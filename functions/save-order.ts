import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
}

interface SaveOrderInput {
  orderId: string;
  customerId: string;
  paymentMethod: string;
  items: OrderItem[];
  total: number;
  payment: {
    transactionId: string;
    processor: string;
    status: string;
  };
}

export const handler = async (event: SaveOrderInput) => {
  const { orderId, customerId, paymentMethod, items, total, payment } = event;
  const now = new Date().toISOString();

  const transactItems = [
    // Order record
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `ORDER#${orderId}`,
          SK: `ORDER#${orderId}`,
          orderId,
          customerId,
          paymentMethod,
          total,
          transactionId: payment.transactionId,
          paymentProcessor: payment.processor,
          paymentStatus: payment.status,
          status: "completed",
          createdAt: now,
        },
      },
    },
    // Order item records
    ...items.map((item) => ({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `ORDER#${orderId}`,
          SK: `ITEM#${item.productId}`,
          orderId,
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
        },
      },
    })),
  ];

  await client.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { orderId, status: "saved" };
};
