// One status → guidance mapping shared by the verification page (server) and
// the account order detail (client) so the two views can never disagree about
// what an order state means. Statuses come from the payments status service.
export function orderGuidance(status: string): string {
  if (status === "pending")
    return "Payment is still awaited — complete it from the checkout session that created the order and submit the proof there.";
  if (status === "claimed")
    return "Proof received — a person reviews the transfer before the order is confirmed. Keep this page handy.";
  if (status === "confirmed" || status === "settled")
    return "Payment received and verified. Staff deliver the service next.";
  if (status === "rejected" || status === "expired")
    return "This order cannot be reopened. Place a new order or ask staff for help with your order ID.";
  return "If this looks wrong, ask staff and keep your order ID handy.";
}
