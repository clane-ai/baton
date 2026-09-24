// Bank payment, as a Clane code node.
//
// The original claims a task, writes a remittance advice into the workspace and registers a payment
// artefact, and it is idempotent by invoice number.
//
// What protects a retry here, stated precisely, because the loose version of this sentence was wrong
// for most of a day. When this node is handed to a worker, the task carries an idempotency key of the
// run and the node, stable across retries of the same step. Passed to the ENGINE that key dedupes
// bookkeeping, so one submission cannot be applied twice. It does nothing about calling the bank: a
// worker that calls and dies before submitting loses its lease, and the next worker calls again.
// Double EXECUTION is prevented by the lease, and only while the lease holds.
//
// So the key is carried here for the code to pass DOWNSTREAM — a bank's own idempotency header, a
// payment reference the receiver dedupes on — which is the only way the guarantee becomes real, and is
// honestly absent for anything that does not honour one. Run inside the platform instead, with no
// worker and no task, none of that applies and a resumed run re-executes the pending node at least
// once with nothing standing in the way.

function main() {
  // Both locals are declared as inputs on the node, so a worker receives them by name.
  const match = typeof invoice_match === 'string' ? JSON.parse(invoice_match) : invoice_match ?? {};
  const supplier_ = typeof supplier === 'string' ? JSON.parse(supplier) : supplier ?? {};
  const invoice = supplier_.invoice ?? {};

  const scheduled = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const payment = {
    payment_ref: `PAY-${String(invoice.invoice_number ?? 'UNKNOWN').replace(/^INV-/, '')}`,
    invoice_number: invoice.invoice_number,
    beneficiary: { name: invoice.vendor },
    amount: Number(match.amount_payable ?? invoice.total ?? 0),
    currency: invoice.currency ?? 'EUR',
    scheduled_for: scheduled,
    status: 'scheduled',
  };

  return {
    ...payment,
    output: `Scheduled ${payment.payment_ref}: ${payment.amount} ${payment.currency} to ${payment.beneficiary.name} on ${payment.scheduled_for}.`,
  };
}
