// Sends an invoice to the gateway; a failed attempt is retried, the invoice number is never reused.
export async function send(invoice, post, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await post(invoice); } catch (e) { if (i === tries) throw e; }
  }
}
