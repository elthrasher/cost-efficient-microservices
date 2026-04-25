import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResult } from "aws-lambda";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (): Promise<APIGatewayProxyResult> => {
  const result = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":sk": "PRODUCT#",
      },
    }),
  );

  const products = (result.Items ?? []).map((item) => ({
    productId: item.productId,
    name: item.name,
    price: item.price,
    description: item.description,
    category: item.category,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ products }),
  };
};
