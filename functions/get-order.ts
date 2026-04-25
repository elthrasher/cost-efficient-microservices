import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const orderId = event.pathParameters?.id;

  if (!orderId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing order ID" }),
    };
  }

  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `ORDER#${orderId}`,
      },
    }),
  );

  if (!result.Items?.length) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Order not found" }),
    };
  }

  const orderRecord = result.Items.find((item) => item.SK.startsWith("ORDER#"));
  const itemRecords = result.Items.filter((item) =>
    item.SK.startsWith("ITEM#"),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      ...orderRecord,
      items: itemRecords,
      PK: undefined,
      SK: undefined,
    }),
  };
};
