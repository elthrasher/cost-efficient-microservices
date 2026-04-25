/**
 * Simulated payment processor. Handles Stripe, PayPal, and Apple Pay
 * with configurable failure rate for demo purposes.
 */

const FAILURE_RATE = parseFloat(process.env.FAILURE_RATE ?? "0.0");

interface PaymentRequest {
  orderId: string;
  processor: string;
  amount: number;
  customerId: string;
  simulateDecline?: boolean;
}

export const handler = async (event: PaymentRequest) => {
  const { orderId, processor, amount, customerId, simulateDecline } = event;

  console.log(
    `Processing payment: ${processor} | $${amount} | order ${orderId}`,
  );

  // Deterministic failure for testing
  if (simulateDecline) {
    throw new Error(`Payment declined by ${processor}`);
  }

  // Random failure based on configured rate
  if (Math.random() < FAILURE_RATE) {
    throw new Error(`${processor} gateway error (simulated transient failure)`);
  }

  // Simulate processing delay
  await new Promise((resolve) =>
    setTimeout(resolve, 100 + Math.random() * 200),
  );

  const transactionId = `txn_${processor}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    transactionId,
    processor,
    amount,
    customerId,
    orderId,
    status: "charged",
    timestamp: new Date().toISOString(),
  };
};
