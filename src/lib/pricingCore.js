// =============================================================================
// pricingCore.js — the shared line-item pricing-engine accessor
// =============================================================================
// ONE engine computes the total for BOTH the contract PDF and the Orders-page
// balance: priceOrderTotals (it physically lives in orderRates.js together with
// its buildLineItems + rate-table dependencies). This module is a DEPENDENCY-FREE
// leaf (imports nothing) so stonebooksData can reach that engine WITHOUT forming a
// static import cycle:
//
//     stonebooksData → orderRates → SalesMode → stonebooksData   ❌ (the cycle)
//     stonebooksData → pricingCore (leaf)                        ✅ (no cycle)
//
// orderRates registers the real engine here at module-load (registerRowGrandTotal);
// stonebooksData reads it through engineRowGrandTotal at render time (orderRates is
// imported by the app shell, so it is always loaded before any order renders).
//
// THE RULE (Paul, final): LINE ITEMS ARE THE PRICE. The registered engine returns
// priceOrderTotals(order).totals.grandTotal — the SUM OF LINE ITEMS, tax/discount
// applied per each line's own flags. NOT reconstructed from basePrice/overrides,
// NOT contract_total, NOT a manual payment_status, and NOT .displayed (so a manual
// grand-total override is ignored for the balance). Orders with no line items
// total $0 (intended).
// =============================================================================

let _rowGrandTotal = null

// orderRates calls this once at load to wire in the real engine.
export function registerRowGrandTotal(fn) { _rowGrandTotal = fn }

// The shared line-item grand total for a RAW snake_case row OR an already-camel
// order. Returns 0 if called before the engine registers (only possible during
// module init — never during a normal render).
export function engineRowGrandTotal(row) {
  return typeof _rowGrandTotal === 'function' ? _rowGrandTotal(row) : 0
}
