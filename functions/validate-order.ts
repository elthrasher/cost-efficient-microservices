import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

interface OrderItem {
  productId: string;
  quantity: number;
}

interface ValidateOrderInput {
  customerId: string;
  paymentMethod: string;
  items: OrderItem[];
}

export const handler = async (event: ValidateOrderInput) => {
  const { customerId, paymentMethod, items } = event;

  if (!customerId || !paymentMethod || !items?.length) {
    throw new Error(
      "Invalid order: missing customerId, paymentMethod, or items",
    );
  }

  const validMethods = ["stripe", "paypal", "applepay"];
  if (!validMethods.includes(paymentMethod)) {
    throw new Error(
      `Invalid payment method: ${paymentMethod}. Must be one of: ${validMethods.join(", ")}`,
    );
  }

  // Batch get all products
  const keys = items.map((item) => ({
    PK: `PRODUCT#${item.productId}`,
    SK: `PRODUCT#${item.productId}`,
  }));

  const result = await client.send(
    new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: { Keys: keys },
      },
    }),
  );

  const products = result.Responses?.[TABLE_NAME] ?? [];
  const productMap = new Map(products.map((p) => [p.productId, p]));

  // Validate each item
  const validatedItems = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }
    if (item.quantity < 1) {
      throw new Error(
        `Invalid quantity for ${item.productId}: ${item.quantity}`,
      );
    }
    return {
      productId: item.productId,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      subtotal: product.price * item.quantity,
    };
  });

  const total = validatedItems.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    customerId,
    paymentMethod,
    items: validatedItems,
    total: Math.round(total * 100) / 100,
  };
};
