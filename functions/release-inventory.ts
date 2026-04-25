import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

interface OrderItem {
  productId: string;
  quantity: number;
}

interface ReleaseInventoryInput {
  items: OrderItem[];
}

/**
 * Compensation handler: releases inventory for all items in the order.
 * Idempotent — safe to call even if some items weren't reserved.
 */
export const handler = async (event: ReleaseInventoryInput) => {
  const { items } = event;

  const results = await Promise.allSettled(
    items.map((item) =>
      client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `PRODUCT#${item.productId}`,
            SK: "INVENTORY",
          },
          UpdateExpression: "SET quantity = quantity + :qty",
          ExpressionAttributeValues: {
            ":qty": item.quantity,
          },
        }),
      ),
    ),
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error("Some inventory releases failed:", failures);
  }

  return {
    released: items.length - failures.length,
    failed: failures.length,
  };
};
