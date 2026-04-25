#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { OrderProcessorStack } from "../lib/order-processor-stack";

const app = new App();

new OrderProcessorStack(app, "OrderProcessorStack", {
  description:
    "Cost-efficient serverless order processing with Step Functions, API Gateway, and DynamoDB",
});
