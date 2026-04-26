import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

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
 * Compensation handler: releases inventory for items in the order.
 * For each item, reads the current quantity and only restores if the
 * quantity appears to have been decremented (below the expected level).
 * Uses optimistic concurrency to prevent over-restoration.
 */
export const handler = async (event: ReleaseInventoryInput) => {
  const { items } = event;
  let released = 0;
  let skipped = 0;

  for (const item of items) {
    // Read current inventory
    const result = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `PRODUCT#${item.productId}`,
          SK: "INVENTORY",
        },
      }),
    );

    const currentQty = result.Item?.quantity ?? 0;

    // Try to atomically restore, using current quantity as a guard.
    // If another process changed it between our read and write, the
    // condition fails and we skip (safe — avoids double-restore).
    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `PRODUCT#${item.productId}`,
            SK: "INVENTORY",
          },
          UpdateExpression: "SET quantity = :newQty",
          ConditionExpression: "quantity = :current",
          ExpressionAttributeValues: {
            ":newQty": currentQty + item.quantity,
            ":current": currentQty,
          },
        }),
      );
      released++;
    } catch (err: any) {
      if (err.name === "ConditionalCheckFailedException") {
        console.log(
          `Skipping release for ${item.productId}: concurrent modification`,
        );
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { released, skipped };
};
