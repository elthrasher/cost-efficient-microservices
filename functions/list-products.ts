import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResult } from "aws-lambda";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const INDEX_NAME = "gsi-category";

// Known product categories — query each partition in the sparse GSI.
// In production you'd either accept category as a query param or
// maintain a category list in the table itself.
const CATEGORIES = ["electronics", "office", "kitchen"];

export const handler = async (): Promise<APIGatewayProxyResult> => {
  const results = await Promise.all(
    CATEGORIES.map((category) =>
      client.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: INDEX_NAME,
          KeyConditionExpression: "category = :cat",
          ExpressionAttributeValues: {
            ":cat": category,
          },
        }),
      ),
    ),
  );

  const products = results.flatMap((r) =>
    (r.Items ?? []).map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      description: item.description,
      category: item.category,
    })),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ products }),
  };
};
