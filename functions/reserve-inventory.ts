import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

interface ReserveItemInput {
  productId: string;
  quantity: number;
}

/**
 * Reserves inventory for a single item using a conditional update.
 * Called once per item by the Map state.
 */
export const handler = async (event: ReserveItemInput) => {
  const { productId, quantity } = event;

  try {
    await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: "INVENTORY",
        },
        UpdateExpression: "SET quantity = quantity - :qty",
        ConditionExpression: "quantity >= :qty",
        ExpressionAttributeValues: {
          ":qty": quantity,
        },
      }),
    );

    return { productId, quantity, reserved: true };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      throw new Error(`Insufficient inventory for product ${productId}`, {
        cause: err,
      });
    }
    throw err;
  }
};
