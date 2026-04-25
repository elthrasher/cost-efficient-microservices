/**
 * Compensation handler: refunds a payment.
 * In a real system this would call the processor's refund API.
 */

interface RefundInput {
  transactionId: string;
  processor: string;
  amount: number;
  orderId: string;
}

export const handler = async (event: RefundInput) => {
  const { transactionId, processor, amount, orderId } = event;

  console.log(
    `Refunding ${transactionId} via ${processor}: $${amount} for order ${orderId}`,
  );

  // Simulate refund processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    refundId: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    transactionId,
    processor,
    amount,
    orderId,
    status: "refunded",
    timestamp: new Date().toISOString(),
  };
};
